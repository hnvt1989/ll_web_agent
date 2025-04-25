// Define the structure for an MCP tool call (can be shared/imported if defined elsewhere)
interface McpToolCall {
    tool_name: 'navigate' | 'search' | 'click' | 'type' | 'scroll' | 'assert_text' | 'dismiss_modal';
    arguments: { [key: string]: any };
    tool_call_id?: string; // Optional ID
}

/**
 * A simple fallback parser using regular expressions to detect basic commands.
 * It attempts to parse only the first recognized command in the instruction.
 *
 * @param instruction The natural language instruction from the user.
 * @returns An array containing a single McpToolCall if a simple command is detected, otherwise an empty array.
 */
export function fallbackParser(instruction: string): McpToolCall[] {
    // Normalize fancy quotes and whitespace
    instruction = instruction
        .replace(/[""'']/g, '"')
        .trim()
        .toLowerCase();
    let match: RegExpMatchArray | null;

    // 1. "go to <url>"
    match = instruction.match(/^go to (https?:\/\/[^\s]+|[^\s]+\.[^\s]+)/i);
    if (match && match[1]) {
        let url = match[1];
        // Basic check if URL needs http:// prefix
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            url = 'http://' + url;
        }
        return [{
            tool_call_id: `fallback_${Date.now()}_${Math.random().toString(36).slice(2)}`,
            tool_name: 'navigate',
            arguments: { url: url }
        }];
    }

    // 2. "click <selector>" (very basic - assumes selector is the rest of the string)
    // More robust parsing would require better selector identification.
    match = instruction.match(/^click (on )?(.*)/i);
    if (match && match[2]) {
         // Assume the rest of the string is a selector-like description
         // In a real scenario, this might need NLP or more specific patterns
        const selector = match[2].trim();
        if (selector) {
             return [{
                tool_call_id: `fallback_${Date.now()}_${Math.random().toString(36).slice(2)}`,
                tool_name: 'click',
                arguments: { selector: selector } // Simple passthrough
            }];
        }
    }

    // 3. "type <text> into <selector>"
    // This regex is quite specific and might need adjustments
    match = instruction.match(/^type ['"]?([^'"]+)['"]? into (.*)/i);
     if (match && match[1] && match[2]) {
        const textToType = match[1].trim();
        const selector = match[2].trim();
        if (textToType && selector) {
            return [{
                tool_call_id: `fallback_${Date.now()}_${Math.random().toString(36).slice(2)}`,
                tool_name: 'type',
                arguments: { selector: selector, text: textToType }
            }];
        }
    }

    // 4. "search for <query>"
    match = instruction.match(/^search for ["']?([^"']+)["']?$/i);
    if (match && match[1]) {
        const query = match[1].trim();
        if (query) {
            return [{
                tool_call_id: `fallback_${Date.now()}_${Math.random().toString(36).slice(2)}`,
                tool_name: 'search',
                arguments: { query }
            }];
        }
    }

    // If no pattern matches, return empty array
    return [];
}

// Example Usage (optional, for testing)
/*
const tests = [
    "go to google.com",
    "click the login button",
    "type 'mypassword' into #password",
    "search for cats", // Should not match
    "Go To https://example.com/page"
];

tests.forEach(test => {
    console.log(`Instruction: "${test}"`);
    const result = fallbackParser(test);
    console.log("Fallback Result:", JSON.stringify(result, null, 2));
    console.log("---");
});
*/ 