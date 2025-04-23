import OpenAI from 'openai';
import { Stream } from 'openai/streaming';

// Define the structure for an MCP tool call based on spec.md
// We might need to refine this based on actual Playwright-MCP requirements
interface McpToolCall {
    tool_name: 'navigate' | 'search' | 'click' | 'type' | 'scroll' | 'assert_text' | 'dismiss_modal';
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
 * @returns A promise that resolves to a list of MCP tool calls.
 */
export async function parseInstruction(instruction: string): Promise<McpToolCall[]> {
    const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
        {
            type: 'function',
            function: {
                name: 'navigate',
                description: 'Navigate the browser to a specific URL.',
                parameters: {
                    type: 'object',
                    properties: {
                        url: { type: 'string', description: 'The absolute or relative URL to navigate to.' },
                    },
                    required: ['url'],
                },
            },
        },
        {
            type: 'function',
            function: {
                name: 'search',
                description: 'Perform a search on the page using a query and optional selector.',
                parameters: {
                    type: 'object',
                    properties: {
                        query: { type: 'string', description: 'The search term.' },
                        selector: { type: 'string', description: '(Optional) CSS selector for the search input field.' },
                    },
                    required: ['query'],
                },
            },
        },
        {
            type: 'function',
            function: {
                name: 'click',
                description: 'Click on an element identified by a CSS selector.',
                parameters: {
                    type: 'object',
                    properties: {
                        selector: { type: 'string', description: 'CSS selector for the element to click.' },
                    },
                    required: ['selector'],
                },
            },
        },
        {
             type: 'function',
             function: {
                name: 'type',
                description: 'Type text into an input field identified by a selector.',
                parameters: {
                    type: 'object',
                    properties: {
                        selector: { type: 'string', description: 'CSS selector for the input field.' },
                        text: { type: 'string', description: 'The text to type.' },
                        isPassword: { type: 'boolean', description: 'Whether the text is a password (for masking). Defaults to false.' }
                    },
                    required: ['selector', 'text'],
                },
            },
        },
         {
             type: 'function',
             function: {
                name: 'scroll',
                description: 'Scroll the page up, down, left, or right by a specified amount or to an edge.',
                parameters: {
                    type: 'object',
                    properties: {
                        direction: { type: 'string', enum: ['up', 'down', 'left', 'right'], description: 'Direction to scroll.' },
                        offset: { type: 'string', description: 'Pixel amount (e.g., "100px") or percentage (e.g., "50%") or "edge".' },
                    },
                    required: ['direction', 'offset'],
                },
            },
        },
        {
            type: 'function',
            function: {
                name: 'assert_text',
                description: 'Verify that an element contains specific text.',
                parameters: {
                    type: 'object',
                    properties: {
                         selector: { type: 'string', description: 'CSS selector for the element.' },
                         text: { type: 'string', description: 'The exact text to assert.' },
                    },
                    required: ['selector', 'text'],
                },
            },
        },
        {
             type: 'function',
             function: {
                name: 'dismiss_modal',
                description: 'Attempt to automatically dismiss any detected modal dialog or pop-up.',
                parameters: { type: 'object', properties: {} }, // No parameters needed
             },
         },
    ];

    try {
        const stream: Stream<OpenAI.Chat.Completions.ChatCompletionChunk> = await openai.chat.completions.create({
            model: 'gpt-4-turbo', // Or your preferred model supporting function calling
            messages: [
                { role: 'system', content: 'You are a web automation assistant. Convert the user\'s instruction into a sequence of tool calls based on the available tools. Generate a maximum of 10 steps.' },
                { role: 'user', content: instruction },
            ],
            tools: tools,
            tool_choice: 'auto', // Let the model decide which tools to call
            stream: true,
        });

        // Refactored: Temporary storage based on index
        const intermediateChunks: { [index: number]: { id?: string; name?: string; arguments: string } } = {};

        console.log('[parseInstruction] Starting stream processing...');
        console.log('[parseInstruction] Entering for await loop...');
        for await (const chunk of stream) {
            const delta = chunk.choices[0]?.delta;

            if (delta?.tool_calls) {
                for (const toolCallDelta of delta.tool_calls) {
                    const index = toolCallDelta.index;
                    // Log details specifically about the tool call delta
                    console.log(`[parseInstruction] Received tool_call delta for Index: ${index}`, JSON.stringify(toolCallDelta));

                    if (index !== undefined) {
                         // Ensure entry exists for this index
                         if (!intermediateChunks[index]) {
                             intermediateChunks[index] = { arguments: '' };
                         }

                         // Update fields if present in the delta
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
        console.log('[parseInstruction] Finished stream processing.');
        console.log('[parseInstruction] Assembled Intermediate Chunks (by index):', JSON.stringify(intermediateChunks));

        // Process the assembled intermediate chunks
        type PotentialToolCall = McpToolCall | null;

        const parsedToolCalls: McpToolCall[] = Object.values(intermediateChunks) // Process values (assembled calls)
             // Ensure sorting by index if needed, though Object.values might preserve insertion order for numeric keys
             // .sort((a, b) => /* compare based on original index if stored */) 
            .map((callInfo, index): PotentialToolCall => { // Map returns PotentialToolCall
                const id = callInfo.id;
                const name = callInfo.name;
                const argsString = callInfo.arguments;
                console.log(`[parseInstruction] Processing assembled chunk for Index ${index} (ID ${id}):`, JSON.stringify(callInfo));

                try {
                    // Ensure all parts are present
                    if (!id || !name || argsString === undefined) { // Check argsString presence
                         console.warn(`Incomplete tool call data for Index ${index} (ID ${id}), skipping.`);
                         return null;
                    }

                    const args = JSON.parse(argsString);
                    // Validate against expected MCP tool names
                    if (['navigate', 'search', 'click', 'type', 'scroll', 'assert_text', 'dismiss_modal'].includes(name)) {
                        return {
                            tool_call_id: id,
                            tool_name: name as McpToolCall['tool_name'],
                            arguments: args,
                        };
                    } else {
                         console.warn(`Unknown tool name received: ${name} for Index ${index} (ID ${id})`);
                         return null; // Filter out unknown tools
                    }
                } catch (error) {
                    console.error(`Failed to parse arguments for tool call at Index ${index} (ID ${id}, Name ${name}): ${argsString}`, error);
                    return null; // Filter out calls with invalid JSON arguments
                }
            })
            .filter((call): call is McpToolCall => call !== null);

         // Basic validation: Limit to 10 steps as per spec
        if (parsedToolCalls.length > 10) {
            console.warn(`Parser generated ${parsedToolCalls.length} steps, truncating to 10.`);
            return parsedToolCalls.slice(0, 10);
        }

        return parsedToolCalls;

    } catch (error) {
        console.error("Error during OpenAI API call or streaming:", error);
        // Depending on requirements, could return an empty list or throw
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