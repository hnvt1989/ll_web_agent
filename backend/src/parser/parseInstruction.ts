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

        // Temporary storage for assembling tool call arguments
        const toolCallChunks: { [id: string]: { name: string; arguments: string } } = {};

        for await (const chunk of stream) {
            const delta = chunk.choices[0]?.delta;

            if (delta?.tool_calls) {
                for (const toolCallDelta of delta.tool_calls) {
                    const id = toolCallDelta.id; // ID is consistent across chunks for the same call
                    // index might be useful for ordering if needed: const index = toolCallDelta.index;

                    if (id && toolCallDelta.function) {
                         if (!toolCallChunks[id]) {
                            // Initialize entry for this tool call ID
                            toolCallChunks[id] = { name: toolCallDelta.function.name || '', arguments: '' };
                        }
                        if (toolCallDelta.function.arguments) {
                            // Append argument chunks
                            toolCallChunks[id].arguments += toolCallDelta.function.arguments;
                        }
                         // Update name if it arrives in a later chunk (though typically in the first)
                        if (toolCallDelta.function.name && !toolCallChunks[id].name) {
                           toolCallChunks[id].name = toolCallDelta.function.name;
                        }
                    }
                }
            }
        }

        // Process the assembled chunks
        // Define an intermediate type that includes null possibility from map
        type PotentialToolCall = McpToolCall | null;

        const parsedToolCalls: McpToolCall[] = Object.entries(toolCallChunks)
            .sort(([, a], [, b]) => {
                // Attempt to maintain order if index was somehow available and stored, otherwise fallback
                // A robust solution might involve storing the index from the delta if present
                return 0; // Simple sort, assuming order is generally preserved or handled later
            })
            .map(([id, callInfo]): PotentialToolCall => { // Map returns PotentialToolCall
                try {
                    // Ensure arguments are fully received before parsing
                    if (!callInfo.name || callInfo.arguments === '') {
                         console.warn(`Incomplete tool call data for ID ${id}, skipping.`);
                         return null;
                    }

                    const args = JSON.parse(callInfo.arguments);
                    // Validate against expected MCP tool names
                    if (['navigate', 'search', 'click', 'type', 'scroll', 'assert_text', 'dismiss_modal'].includes(callInfo.name)) {
                        return {
                            tool_call_id: id, // Keep the ID for potential mapping/tracking
                            tool_name: callInfo.name as McpToolCall['tool_name'],
                            arguments: args,
                        };
                    } else {
                         console.warn(`Unknown tool name received: ${callInfo.name}`);
                         return null; // Filter out unknown tools
                    }
                } catch (error) {
                    console.error(`Failed to parse arguments for tool call ${id} (${callInfo.name}): ${callInfo.arguments}`, error);
                    return null; // Filter out calls with invalid JSON arguments
                }
            })
            // Now the filter correctly narrows PotentialToolCall down to McpToolCall
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