import OpenAI from 'openai';
import { Stream } from 'openai/streaming';

// Define the structure for an MCP tool call based on spec.md
// We might need to refine this based on actual Playwright-MCP requirements
interface McpToolCall {
    tool_name: string; // Use string, actual names come from mcpTools
    arguments: { [key: string]: any };
    tool_call_id?: string; // Added for potential OpenAI response mapping
}

// Assume OpenAI client is initialized and configured elsewhere
// For this example, we'll initialize it here. Replace with your actual client setup.
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY, // Ensure this is configured
});

/**
 * Parses a natural language instruction into a sequence of MCP tool calls
 * using OpenAI's function calling feature with streaming.
 *
 * @param instruction The natural language instruction from the user.
 * @param mcpTools An optional array of MCP tools to use instead of the default tools.
 * @returns A promise that resolves to a list of MCP tool calls.
 */
export async function parseInstruction(
    instruction: string,
    mcpTools?: { name: string; description?: string; inputSchema: any }[]
): Promise<McpToolCall[]> {

    // Derive tools ONLY from the provided mcpTools list
    const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = (mcpTools && mcpTools.length > 0) ?
        mcpTools.map(t => ({
            type: 'function',
            function: {
                name: t.name,
                description: t.description || `Execute the ${t.name} tool.`, // Add a default description if missing
                parameters: t.inputSchema ? { ...t.inputSchema } : { type: 'object', properties: {} } // Use provided schema or empty object
            }
        })) : []; // If no mcpTools provided, send an empty tools list

    // If no tools are available from the MCP server, we cannot fulfill the request.
    if (tools.length === 0) {
        console.warn('[parseInstruction] No MCP tools provided or available. Cannot parse instruction.');
        // Optionally, could return a specific error message or indicator to the orchestrator/UI
        return [];
    }

    // Keep track of the names of the tools actually sent to the API
    const allowedToolNames = new Set(tools.map(t => t.function.name));

    try {
        console.log(`[parseInstruction] Calling OpenAI with instruction: "${instruction}" and tools:`, JSON.stringify(Array.from(allowedToolNames)));

        const stream: Stream<OpenAI.Chat.Completions.ChatCompletionChunk> = await openai.chat.completions.create({
            model: 'gpt-4-turbo',
            messages: [
                { 
                    role: 'system',
                    content: `You are a web automation assistant. Convert the user's instruction into a sequence of tool calls using ONLY the provided tools. 
                    - Generate a maximum of 10 steps.
                    - Use the exact tool names provided in the list.
                    - Decompose complex actions: For example, a "search" instruction should be broken down into a 'browser_screen_type' call (for the query) potentially followed by a 'browser_screen_click' call (if a search button needs clicking) or setting the 'submit' argument to true in 'browser_screen_type'.
                    - If a user request cannot be fulfilled with the available tools (e.g., asking to 'download a file' when no download tool exists), indicate that you cannot perform the action by returning an empty list of tool calls.` 
                },
                { role: 'user', content: instruction },
            ],
            tools: tools,
            tool_choice: 'auto',
            stream: true,
        });

        const intermediateChunks: { [index: number]: { id?: string; name?: string; arguments: string } } = {};

        for await (const chunk of stream) {
            const delta = chunk.choices[0]?.delta;

            if (delta?.tool_calls) {
                for (const toolCallDelta of delta.tool_calls) {
                    const index = toolCallDelta.index;

                    if (index !== undefined) {
                         if (!intermediateChunks[index]) {
                             intermediateChunks[index] = { arguments: '' };
                         }

                         if (toolCallDelta.id) {
                             intermediateChunks[index].id = toolCallDelta.id;
                         }
                         if (toolCallDelta.function?.name) {
                             intermediateChunks[index].name = toolCallDelta.function.name;
                         }
                         if (toolCallDelta.function?.arguments) {
                             intermediateChunks[index].arguments += toolCallDelta.function.arguments;
                         }
                    }
                }
            }
        }

        type PotentialToolCall = McpToolCall | null;

        const parsedToolCalls: McpToolCall[] = Object.values(intermediateChunks)
            .map((callInfo, index): PotentialToolCall => {
                const id = callInfo.id;
                const name = callInfo.name;
                const argsString = callInfo.arguments;

                try {
                    if (!id || !name || argsString === undefined) {
                         console.warn(`Incomplete tool call data for Index ${index} (ID ${id}), skipping.`);
                         return null;
                    }

                    // Validate that the returned tool name was one we actually sent to the API
                    if (!allowedToolNames.has(name)) {
                        console.warn(`LLM returned a tool name ("${name}") that was not in the allowed list for Index ${index} (ID ${id}). Skipping.`);
                        return null;
                    }

                    const args = JSON.parse(argsString);
                    // No need for the 'in tools' check anymore, we validated against allowedToolNames
                    return {
                        tool_call_id: id,
                        tool_name: name, // Use the validated name directly
                        arguments: args,
                    };

                } catch (error) {
                    console.error(`Failed to parse arguments for tool call at Index ${index} (ID ${id}, Name ${name}): ${argsString}`, error);
                    return null;
                }
            })
            .filter((call): call is McpToolCall => call !== null);

        // REMOVED Fallback Logic Section
        /*
        let finalCalls = parsedToolCalls;

        // Heuristic: if fewer than 2 calls, try fallback split parser for multi-clause instructions
        if (finalCalls.length < 2) {
            try {
                const { fallbackParser } = await import('./fallback');
                const segments = instruction.split(/\b(?:and then|,\s*then|and|then)\b/i).map(s => s.trim()).filter(Boolean);
                const fallbackCalls: McpToolCall[] = [];
                for (const seg of segments) {
                    const calls = fallbackParser(seg);
                    if (calls.length) fallbackCalls.push(...calls);
                }
                if (fallbackCalls.length > finalCalls.length) {
                    console.log('[parseInstruction] Using fallback multi-segment parser, produced', fallbackCalls.length, 'calls');
                    finalCalls = fallbackCalls;
                }
            } catch (e) {
                console.error('Fallback parser import/use failed:', e);
            }
        }
        */
       
        // Use the result directly from OpenAI parsing
        let finalCalls = parsedToolCalls;

        if (finalCalls.length > 10) {
            console.warn(`Parser generated ${finalCalls.length} steps, truncating to 10.`);
            finalCalls = finalCalls.slice(0, 10);
        }

        console.log('[parseInstruction] Successfully parsed calls:', JSON.stringify(finalCalls, null, 2));
        return finalCalls;

    } catch (error) {
        console.error("Error during OpenAI API call or streaming:", error);
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