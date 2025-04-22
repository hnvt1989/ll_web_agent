import { parseInstruction } from '../src/parser/parseInstruction';
import { fallbackParser } from '../src/parser/fallback';
import OpenAI from 'openai';
import { Stream } from 'openai/streaming'; // Needed for type casting mock

// Mock the OpenAI module
jest.mock('openai', () => {
    // Mock the constructor and the chat.completions.create method
    const mockCreate = jest.fn();
    return jest.fn().mockImplementation(() => ({
        chat: {
            completions: {
                create: mockCreate,
            },
        },
    }));
});

// Helper to create a mock stream from tool call chunks
function createMockStream(chunks: any[]): Stream<OpenAI.Chat.Completions.ChatCompletionChunk> {
    async function* generate() {
        for (const chunk of chunks) {
            yield chunk;
        }
    }
    // Cast to the expected Stream type
    return generate() as Stream<OpenAI.Chat.Completions.ChatCompletionChunk>;
}

// Define a type for our mock function for easier casting
type MockedCreate = jest.MockedFunction<typeof OpenAI.prototype.chat.completions.create>;

// Get the mock instance after jest.mock has run
let mockedCreate: MockedCreate;
beforeEach(() => {
    // Reset mocks before each test
     mockedCreate = new OpenAI().chat.completions.create as MockedCreate;
     mockedCreate.mockClear();
});


describe('Instruction Parser', () => {

    describe('parseInstruction (OpenAI)', () => {

        it('should limit the number of steps to 10', async () => {
            // Simulate OpenAI returning 12 tool calls
            const mockToolCallsData = Array.from({ length: 12 }, (_, i) => ({
                id: `call_${i}`,
                function: {
                    name: 'click',
                    arguments: JSON.stringify({ selector: `#button-${i}` }),
                },
            }));

            // Simulate streaming chunks for these 12 calls
            const streamChunks = mockToolCallsData.flatMap(call => [
                 { choices: [{ delta: { tool_calls: [{ index: 0, id: call.id, type: 'function', function: { name: call.function.name, arguments: '' } }] } }] },
                 { choices: [{ delta: { tool_calls: [{ index: 0, id: call.id, type: 'function', function: { arguments: call.function.arguments } }] } }] }
            ]);


            mockedCreate.mockResolvedValue(createMockStream(streamChunks));

            const instruction = "Click 12 buttons";
            const result = await parseInstruction(instruction);

            expect(result).toHaveLength(10); // Check if truncated
            expect(result[0].tool_name).toBe('click');
            expect(result[9].arguments.selector).toBe('#button-9');
             // Verify OpenAI was called
            expect(mockedCreate).toHaveBeenCalledTimes(1);
        });

        it('should handle instructions with unsupported verbs (returning empty)', async () => {
            // Simulate OpenAI returning no tool calls for an unsupported action
             const mockStream = createMockStream([
                { choices: [{ delta: { content: "I cannot fulfill this request." } }] } // Simulate text response instead of tool call
             ]);

            mockedCreate.mockResolvedValue(mockStream);

            const instruction = "Download the specification document"; // Verb 'Download' is not supported
            const result = await parseInstruction(instruction);

            expect(result).toHaveLength(0);
            expect(mockedCreate).toHaveBeenCalledTimes(1);
        });

         it('should handle OpenAI API errors gracefully', async () => {
            // Simulate an error during the API call/stream
            mockedCreate.mockRejectedValue(new Error("API Error"));

            const instruction = "Go to example.com";
             // Capture console.error output if desired
             const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

            const result = await parseInstruction(instruction);

            expect(result).toHaveLength(0); // Expect empty array on error
            expect(mockedCreate).toHaveBeenCalledTimes(1);
            expect(consoleSpy).toHaveBeenCalledWith("Error during OpenAI API call or streaming:", expect.any(Error));

            consoleSpy.mockRestore(); // Restore console.error
        });

          it('should correctly parse a simple instruction into tool calls', async () => {
            // Simulate OpenAI returning tool calls for a simple sequence
            const mockToolCallsData = [
                { id: 'call_1', function: { name: 'navigate', arguments: JSON.stringify({ url: 'https://google.com' }) } },
                { id: 'call_2', function: { name: 'type', arguments: JSON.stringify({ selector: 'input[name="q"]', text: 'OpenAI' }) } },
            ];
             const streamChunks = mockToolCallsData.flatMap(call => [
                 { choices: [{ delta: { tool_calls: [{ index: 0, id: call.id, type: 'function', function: { name: call.function.name, arguments: '' } }] } }] },
                 { choices: [{ delta: { tool_calls: [{ index: 0, id: call.id, type: 'function', function: { arguments: call.function.arguments } }] } }] }
            ]);


            mockedCreate.mockResolvedValue(createMockStream(streamChunks));

            const instruction = "Go to google.com and type OpenAI";
            const result = await parseInstruction(instruction);

            expect(result).toHaveLength(2);
            expect(result[0]).toMatchObject({ tool_name: 'navigate', arguments: { url: 'https://google.com' }, tool_call_id: 'call_1' });
            expect(result[1]).toMatchObject({ tool_name: 'type', arguments: { selector: 'input[name="q"]', text: 'OpenAI' }, tool_call_id: 'call_2'});
            expect(mockedCreate).toHaveBeenCalledTimes(1);
        });
    });

     describe('fallbackParser (Regex)', () => {
         // This section covers the "Partial parse fallback" scenario by testing the fallback directly.
         // We assume if parseInstruction fails or returns empty, the orchestrator *might* call this.

        it('should parse "go to <url>"', () => {
            const instruction = "go to example.com";
            const result = fallbackParser(instruction);
            expect(result).toHaveLength(1);
            expect(result[0]).toEqual({ tool_name: 'navigate', arguments: { url: 'http://example.com' } });
        });

         it('should parse "go to <https-url>"', () => {
            const instruction = "Go To https://secure.com/page";
            const result = fallbackParser(instruction);
            expect(result).toHaveLength(1);
            expect(result[0]).toEqual({ tool_name: 'navigate', arguments: { url: 'https://secure.com/page' } });
         });


        it('should parse "click <selector>"', () => {
            const instruction = "click the big red button";
            const result = fallbackParser(instruction);
            expect(result).toHaveLength(1);
            expect(result[0]).toEqual({ tool_name: 'click', arguments: { selector: 'the big red button' } }); // Basic passthrough
        });

         it('should parse "click on <selector>"', () => {
            const instruction = "click on #submit-btn";
            const result = fallbackParser(instruction);
            expect(result).toHaveLength(1);
            expect(result[0]).toEqual({ tool_name: 'click', arguments: { selector: '#submit-btn' } });
         });


        it('should parse "type <text> into <selector>"', () => {
            const instruction = "type 'hello world' into #search-box";
            const result = fallbackParser(instruction);
            expect(result).toHaveLength(1);
            expect(result[0]).toEqual({ tool_name: 'type', arguments: { selector: '#search-box', text: 'hello world' } });
        });

         it('should parse "type <text> into <selector>" without quotes', () => {
            const instruction = "type username123 into input[name=username]";
             const result = fallbackParser(instruction);
             expect(result).toHaveLength(1);
             expect(result[0]).toEqual({ tool_name: 'type', arguments: { selector: 'input[name=username]', text: 'username123' } });
         });

        it('should return empty array for non-matching instructions', () => {
            const instruction = "search for images of cats"; // 'search' not handled by fallback
            const result = fallbackParser(instruction);
            expect(result).toHaveLength(0);
        });

         it('should return empty array for empty input', () => {
            const instruction = "";
            const result = fallbackParser(instruction);
            expect(result).toHaveLength(0);
         });

    });
}); 