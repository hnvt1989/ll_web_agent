import Anthropic from '@anthropic-ai/sdk';

// Debug log for the API key (redacting most of it for security)
const apiKey = process.env.ANTHROPIC_API_KEY || '';
console.log('[anthropicClient] ANTHROPIC_API_KEY present:', !!apiKey);
if (apiKey) {
    // Only show first few and last few characters for security
    const maskedKey = apiKey.length > 8
        ? `${apiKey.substring(0, 4)}...${apiKey.substring(apiKey.length - 4)}`
        : '****';
    console.log('[anthropicClient] ANTHROPIC_API_KEY format:', maskedKey);
} else {
    console.error('[anthropicClient] CRITICAL: ANTHROPIC_API_KEY environment variable is not set.');
    // Optionally throw an error or exit if the key is essential for the app to run
    // process.exit(1);
}

// Initialize Anthropic client
const anthropic = new Anthropic({
    apiKey: apiKey, // Use the validated key
});

// Function to test if the API key is valid (can be called optionally)
async function testAnthropicApiKey(): Promise<boolean> {
    if (!apiKey) return false; // No key, definitely not valid
    try {
        console.log('[anthropicClient] Testing Anthropic API key validity...');
        // Use a less resource-intensive model for testing if possible, or keep opus
        await anthropic.messages.create({
            model: 'claude-3-haiku-20240307', // Use a smaller model for quicker check
            max_tokens: 10,
            messages: [{ role: 'user', content: 'Hello' }]
        });
        console.log('[anthropicClient] Anthropic API key appears valid!');
        return true;
    } catch (error: any) {
        console.error('[anthropicClient] Error testing Anthropic API key:', error.message || error);
        if (error.status === 401) {
            console.error('[anthropicClient] API key is invalid or unauthorized');
        } else if (error.status === 404) {
            console.error('[anthropicClient] Model not found - check model name used for testing');
        }
        return false;
    }
}

// Export the initialized client and the test function
export { anthropic, testAnthropicApiKey }; 