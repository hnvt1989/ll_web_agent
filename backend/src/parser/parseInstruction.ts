import Anthropic from '@anthropic-ai/sdk';

// Define the structure for an MCP tool call based on spec.md
// We might need to refine this based on actual Playwright-MCP requirements
interface McpToolCall {
    tool_name: string; // Use string, actual names come from mcpTools
    arguments: { [key: string]: any };
    tool_call_id?: string; // Added for potential OpenAI response mapping
}

// Debug log for the API key (redacting most of it for security)
const apiKey = process.env.ANTHROPIC_API_KEY || '';
console.log('[parseInstruction] ANTHROPIC_API_KEY present:', !!apiKey);
if (apiKey) {
    // Only show first few and last few characters for security
    const maskedKey = apiKey.length > 8 
        ? `${apiKey.substring(0, 4)}...${apiKey.substring(apiKey.length - 4)}`
        : '****';
    console.log('[parseInstruction] ANTHROPIC_API_KEY format:', maskedKey);
}

// Check if OpenAI API key is available (for potential fallback)
const openaiApiKey = process.env.OPENAI_API_KEY || '';
console.log('[parseInstruction] OPENAI_API_KEY present:', !!openaiApiKey);
if (openaiApiKey) {
    const maskedOpenAiKey = openaiApiKey.length > 8
        ? `${openaiApiKey.substring(0, 4)}...${openaiApiKey.substring(openaiApiKey.length - 4)}`
        : '****';
    console.log('[parseInstruction] OPENAI_API_KEY format:', maskedOpenAiKey);
}

// Initialize Anthropic client
const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY, // Use the Anthropic API key from environment
});

// Function to test if the API key is valid
async function testAnthropicApiKey(): Promise<boolean> {
    try {
        console.log('[parseInstruction] Testing Anthropic API key validity...');
        await anthropic.messages.create({
            model: 'claude-3-opus-20240229',
            max_tokens: 10,
            messages: [{ role: 'user', content: 'Hello' }]
        });
        console.log('[parseInstruction] Anthropic API key is valid!');
        return true;
    } catch (error: any) {
        console.error('[parseInstruction] Error testing Anthropic API key:', error.message || error);
        if (error.status === 401) {
            console.error('[parseInstruction] API key is invalid or unauthorized');
        } else if (error.status === 404) {
            console.error('[parseInstruction] Model not found - check model name');
        }
        return false;
    }
}

/**
 * Parses a natural language instruction into a sequence of MCP tool calls
 * using Anthropic Claude's tool calling feature.
 *
 * @param instruction The natural language instruction from the user.
 * @param mcpTools An optional array of MCP tools to use instead of the default tools.
 * @returns A promise that resolves to a list of MCP tool calls.
 */
export async function parseInstruction(
    instruction: string,
    mcpTools?: { name: string; description?: string; inputSchema: any }[]
): Promise<McpToolCall[]> {
    // Test API key validity first
    const isApiKeyValid = await testAnthropicApiKey();
    if (!isApiKeyValid) {
        console.error('[parseInstruction] Cannot proceed with invalid Anthropic API key');
        return [];
    }

    // Derive tools from the provided mcpTools list
    const tools = (mcpTools && mcpTools.length > 0) ?
        mcpTools.map(t => ({
            name: t.name,
            description: t.description || `Execute the ${t.name} tool.`,
            input_schema: t.inputSchema || { type: 'object', properties: {} }
        })) : [];

    // If no tools are available from the MCP server, we cannot fulfill the request.
    if (tools.length === 0) {
        console.warn('[parseInstruction] No MCP tools provided or available. Cannot parse instruction.');
        // Optionally, could return a specific error message or indicator to the orchestrator/UI
        return [];
    }

    // Keep track of the names of the tools actually sent to the API
    const allowedToolNames = new Set(tools.map(t => t.name));

    try {
        console.log(`[parseInstruction] Calling Anthropic Claude with instruction: "${instruction}" and tools:`, JSON.stringify(Array.from(allowedToolNames)));

        // Define a list of models to try in order of preference
        const modelOptions = [
            'claude-3-opus-20240229',  // Try a standard model name
            // 'claude-3-7-sonnet-20250129',  // Commented out the specific model
            // 'claude-3-haiku',           // Commented out other models
            // 'claude-3-opus',
            // 'claude-3-sonnet',
            // 'claude-instant-1.2',
            // 'claude-2.0'
        ];
        
        let lastError: any = null;
        let response: any = null;
        
        // Try each model in sequence until one works
        for (const model of modelOptions) {
            try {
                console.log(`[parseInstruction] Attempting to use model: ${model}`);
                response = await anthropic.messages.create({
                    model: model,
                    max_tokens: 4000,
                    system: `You are a web automation assistant specialized in converting natural language instructions into a sequence of precise tool calls.

CRITICAL RULES:
1. For EACH action in the user's instruction, generate a SEPARATE tool call.
2. If the user asks to perform an action multiple times (e.g., "click button twice"), create a separate tool call for EACH instance.
3. Always break down complex tasks into individual steps, never combine actions.
4. Preserve the sequential order of actions exactly as specified.
5. Use ONLY the exact tool names provided in the available tools list.
6. DO NOT include any explanatory text, ONLY generate tool calls.`,
                    messages: [
                        { 
                            role: 'user', 
                            content: `Here is a web automation task that needs to be broken down into sequential tool calls:

"${instruction}"

Please convert this into a series of individual tool calls, making sure to create a separate tool call for each distinct action.`
                        }
                    ],
                    tools: tools,
                    tool_choice: { type: "any" }
                });
                
                // If we got here, the model worked
                console.log(`[parseInstruction] Successfully used model: ${model}`);
                break;
                
            } catch (err: any) {
                lastError = err;
                console.error(`[parseInstruction] Failed with model ${model}:`, err.message || err);
                // Continue to the next model
            }
        }
        
        // If all models failed, throw the last error
        if (!response) {
            console.error('[parseInstruction] All models failed. Last error:', lastError);
            throw lastError || new Error('All Anthropic models failed');
        }

        // Debug logging of the complete response
        console.log('[parseInstruction] Complete Anthropic response:', JSON.stringify(response, null, 2));
        console.log('[parseInstruction] Response content length:', response.content.length);
        
        // Define types for response content
        type ContentItem = {
            type: string;
            id?: string;
            name?: string;
            input?: any;
            text?: string;
        };
        
        response.content.forEach((item: ContentItem, index: number) => {
            console.log(`[parseInstruction] Content item ${index} type:`, item.type);
            if (item.type === 'tool_use') {
                console.log(`[parseInstruction] Tool use: name=${item.name}, id=${item.id}`);
                console.log(`[parseInstruction] Tool input:`, JSON.stringify(item.input, null, 2));
            } else if (item.type === 'text') {
                console.log(`[parseInstruction] Text content: "${item.text?.substring(0, 100)}${item.text && item.text.length > 100 ? '...' : ''}"`);
            }
        });

        // Extract tool calls from the response
        const toolCalls = response.content
            .filter((content: ContentItem) => content.type === 'tool_use')
            .map((content: ContentItem) => {
                if (content.type !== 'tool_use') return null;
                
                // Validate that the returned tool name is in the allowed list
                if (!content.name || !allowedToolNames.has(content.name)) {
                    console.warn(`Claude returned a tool name ("${content.name}") that was not in the allowed list. Skipping.`);
                    return null;
                }
                
                return {
                    tool_call_id: content.id || `claude-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
                    tool_name: content.name,
                    arguments: content.input
                } as McpToolCall;
            })
            .filter((call: McpToolCall | null): call is McpToolCall => call !== null);

        // Log the number of tool calls extracted
        console.log(`[parseInstruction] Extracted ${toolCalls.length} tool calls from the response.`);
        
        // If no tool calls were found but there's text content, Claude might be describing the steps instead of using tools
        if (toolCalls.length === 0 && response.content.some((content: ContentItem) => content.type === 'text')) {
            console.warn('[parseInstruction] Claude returned text instead of tool calls. This may indicate it did not understand the task.');
            // Future improvement: Could implement a fallback to parse text instructions
        }

        // Use the result directly
        let finalCalls = toolCalls;

        if (finalCalls.length > 10) {
            console.warn(`Parser generated ${finalCalls.length} steps, truncating to 10.`);
            finalCalls = finalCalls.slice(0, 10);
        }

        // Add a browser_snapshot call at the beginning if it's not already there
        const hasSnapshot = finalCalls.some((call: McpToolCall) => call.tool_name === 'browser_snapshot');
        if (!hasSnapshot && finalCalls.length > 0) {
            console.log('[parseInstruction] Adding initial browser_snapshot call for reference extraction');
            
            // Create snapshot tool call
            const snapshotCall: McpToolCall = {
                tool_name: 'browser_snapshot',
                tool_call_id: `snapshot_${Date.now()}`,
                arguments: {}
            };
            
            // Add it at the beginning
            finalCalls = [snapshotCall, ...finalCalls];
            
            // Make sure we're still within the 10 step limit
            if (finalCalls.length > 10) {
                finalCalls = finalCalls.slice(0, 10);
            }
        }

        console.log('[parseInstruction] Successfully parsed calls:', JSON.stringify(finalCalls, null, 2));
        return finalCalls;

    } catch (error) {
        // Enhanced error handling for Anthropic API errors
        console.error("Error during Anthropic Claude API call:", error);
        
        // Log specific details if it's an API error
        if (error && typeof error === 'object' && 'status' in error) {
            console.error(`[parseInstruction] Anthropic API error status: ${(error as any).status}`);
            console.error(`[parseInstruction] Error type: ${(error as any).error?.error?.type}`);
            console.error(`[parseInstruction] Error message: ${(error as any).error?.error?.message}`);
            
            // Special handling for model not found errors
            if ((error as any).error?.error?.type === 'not_found_error' && 
                (error as any).error?.error?.message?.includes('model:')) {
                console.error('[parseInstruction] Invalid model name. Please update to a valid Claude model.');
                console.error('[parseInstruction] Available models include: claude-3-opus, claude-3-sonnet, claude-3-haiku');
            }
        }
        
        // Return empty array to indicate failure
        return [];
    }
}

// Example Usage (optional, for testing)
/*
async function testParse() {
    const instruction = "Go to google.com, search for 'Playwright-MCP', and then click the first result link.";
    console.log(`Parsing instruction: "${instruction}"`);
    const toolCalls = await parseInstruction(instruction);
    console.log("Parsed Tool Calls:", JSON.stringify(toolCalls, null, 2));
}

testParse();
*/ 