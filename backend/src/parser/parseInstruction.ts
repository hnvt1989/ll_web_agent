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
 * @param mcpTools An optional array of MCP tools to use instead of the default tools.
 * @returns A promise that resolves to a list of MCP tool calls.
 */
export async function parseInstruction(
    instruction: string,
    mcpTools?: { name: string; description?: string; inputSchema: any }[]
): Promise<McpToolCall[]> {
    let baseTools: OpenAI.Chat.Completions.ChatCompletionTool[] = mcpTools && mcpTools.length > 0 ?
        mcpTools.map(t => ({
            type: 'function',
            function: {
                name: t.name,
                description: t.description || '',
                parameters: t.inputSchema ? { ...t.inputSchema } : { type: 'object', properties: {} }
            }
        })) : [
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
                name: 'click',
                description: 'Click on an element identified by a CSS selector or reference.',
                parameters: {
                    type: 'object',
                    properties: {
                        ref: { type: 'string', description: 'The exact target element reference from the page snapshot.' },
                        element: { type: 'string', description: 'Human-readable element description used to obtain permission.'}
                    },
                    required: ['ref', 'element'],
                },
            },
        },
        {
             type: 'function',
             function: {
                name: 'type',
                description: 'Type text into an input field identified by reference.',
                parameters: {
                    type: 'object',
                    properties: {
                         ref: { type: 'string', description: 'Exact target element reference from the page snapshot.' },
                         element: { type: 'string', description: 'Human-readable element description.'},
                        text: { type: 'string', description: 'The text to type.' },
                         submit: { type: 'boolean', description: 'Whether to press Enter after typing. Default false.', default: false },
                    },
                     required: ['ref', 'element', 'text'],
                },
            },
        },
         {
             type: 'function',
             function: {
                name: 'scroll',
                description: 'Scroll the page up, down, left, or right by a specified amount or to an edge. (Note: May not directly map to a standard Playwright MCP tool)',
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
                description: 'Verify that an element contains specific text. (Note: May not directly map to a standard Playwright MCP tool)',
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
                description: 'Attempt to automatically dismiss any detected modal dialog or pop-up by accepting or dismissing it.',
                 parameters: {
                    type: 'object',
                     properties: {
                         accept: { type: 'boolean', description: 'Whether to accept the dialog. Defaults to true (dismiss).' }
                    },
                 },
             },
         },
    ];

    // Use the derived/fallback tools directly
    const tools = baseTools;

    try {
        const stream: Stream<OpenAI.Chat.Completions.ChatCompletionChunk> = await openai.chat.completions.create({
            model: 'gpt-4-turbo',
            messages: [
                { role: 'system', content: `You are a web automation assistant. Convert the user\'s instruction into a sequence of tool calls using ONLY the provided tools. Generate a maximum of 10 steps. Use the exact tool names provided in the list. If a user request cannot be fulfilled with the available tools (e.g., asking to 'search' when no search tool exists), indicate that you cannot perform the action instead of hallucinating a tool call.` },
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

                    const args = JSON.parse(argsString);
                    if (name as McpToolCall['tool_name'] in tools) {
                        return {
                            tool_call_id: id,
                            tool_name: name as McpToolCall['tool_name'],
                            arguments: args,
                        };
                    } else {
                         console.warn(`Unknown tool name received: ${name} for Index ${index} (ID ${id})`);
                         return null;
                    }
                } catch (error) {
                    console.error(`Failed to parse arguments for tool call at Index ${index} (ID ${id}, Name ${name}): ${argsString}`, error);
                    return null;
                }
            })
            .filter((call): call is McpToolCall => call !== null);

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