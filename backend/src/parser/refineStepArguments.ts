import { Call } from '../types/mcp'; // Assuming Call type is defined here
import { anthropic } from '../llm/anthropicClient'; // Import shared client
import Anthropic from '@anthropic-ai/sdk'; // Import types if needed

// Placeholder for the actual LLM client (e.g., Anthropic)
// import anthropic from './anthropicClient'; // Example import

// Helper function to truncate potentially large snapshots for the prompt
function truncateSnapshot(snapshot: string, maxLength: number = 10000): string {
    if (snapshot.length > maxLength) {
        // Try to truncate intelligently, maybe keep start and end?
        const halfLength = Math.floor(maxLength / 2) - 10; // Leave space for ellipsis
        return `${snapshot.substring(0, halfLength)}... (truncated) ...${snapshot.substring(snapshot.length - halfLength)}`;
    }
    return snapshot;
}

/**
 * Refines the arguments of a tool call using a provided snapshot via an LLM call.
 *
 * @param callToRefine The original Call object with potentially placeholder arguments.
 * @param snapshot The page snapshot content (likely HTML or structured text).
 * @returns A Promise resolving to a new Call object with refined arguments.
 * @throws An error if the refinement process fails or LLM response is unusable.
 */
export async function refineStepArgumentsWithSnapshot(
    callToRefine: Call,
    snapshot: string
): Promise<Call> {
    console.log('[refineStepArguments] Received call to refine:', callToRefine);
    // Only log length or a small part of the snapshot to avoid huge logs
    console.log(`[refineStepArguments] Received snapshot (length: ${snapshot?.length ?? 0})`);

    // Check if refinement is actually needed
    const originalParams = typeof callToRefine.params === 'object' && callToRefine.params !== null
        ? callToRefine.params
        : {};
    const needsRefinement = Object.values(originalParams).some(value => value === '<UNKNOWN>');

    if (!needsRefinement) {
        console.log('[refineStepArguments] No <UNKNOWN> arguments found. Skipping refinement.');
        return { ...callToRefine, params: originalParams }; // Return original if no refinement needed
    }

    const truncatedSnap = truncateSnapshot(snapshot); // Limit snapshot size for the prompt

    // --- LLM Call Implementation ---
    // 1. Construct the prompt
    //    - Explain the task: Refine arguments based on snapshot.
    //    - Provide the original tool call details.
    //    - Provide the snapshot context.
    //    - Instruct the LLM to output *only* the refined JSON arguments object.
    const systemPrompt = `You are an expert assistant analyzing web page snapshots to determine the correct arguments for web automation tool calls.\nGiven a tool call with potentially unknown arguments (marked as "<UNKNOWN>") and a snapshot of the relevant web page, your task is to analyze the snapshot and replace the "<UNKNOWN>" values with the correct values found in the snapshot.\n\nOutput ONLY the refined JSON object for the 'params' (arguments) of the tool call. Do not include any other text, explanations, or markdown formatting.`;

    const userPrompt = `Tool call to refine:\nTool Name: ${callToRefine.method}\nOriginal Arguments: ${JSON.stringify(originalParams, null, 2)}\n\nWeb Page Snapshot (HTML/Content):\n\`\`\`\n${truncatedSnap}\n\`\`\`\n\nBased on the snapshot, determine the correct values for any "<UNKNOWN>" arguments in the original arguments object.\nOutput ONLY the refined JSON arguments object. For example, if the original arguments were {"selector": "<UNKNOWN>", "text": "hello"} and the snapshot indicated the correct selector is "#login-button", you should output:\n{"selector": "#login-button", "text": "hello"}\nIf an argument cannot be determined from the snapshot, retain its original value or omit it if appropriate based on the tool's function (but prioritize filling unknowns).`;

    try {
        console.log(`[refineStepArguments] Calling Anthropic to refine arguments for ${callToRefine.method}...`);
        // 2. Make the API call
        const response = await anthropic.messages.create({
            // Use a capable model like Opus or Sonnet for better analysis
            model: 'claude-3-opus-20240229', // Or claude-3-5-sonnet-20240620
            max_tokens: 500, // Adjust as needed, should be enough for JSON args
            system: systemPrompt,
            messages: [{ role: 'user', content: userPrompt }],
            temperature: 0.2, // Lower temperature for more deterministic JSON output
        });

        console.log('[refineStepArguments] Received Anthropic response.');

        // 3. Parse the response
        if (!response.content || response.content.length === 0 || response.content[0].type !== 'text') {
            throw new Error('LLM response did not contain text content.');
        }

        const llmOutput = response.content[0].text.trim();
        console.log('[refineStepArguments] Raw LLM output:', llmOutput);

        let refinedParams: { [key: string]: any };
        try {
            // Attempt to parse the output directly as JSON
            refinedParams = JSON.parse(llmOutput);
            console.log('[refineStepArguments] Successfully parsed LLM output as JSON:', refinedParams);
        } catch (parseError) {
            // If direct parsing fails, try extracting JSON from potential markdown code blocks
            console.warn('[refineStepArguments] Failed to parse LLM output directly as JSON. Attempting extraction...');
            const jsonMatch = llmOutput.match(/```(?:json)?\\s*([\\s\\S]*?)\\s*```/);
            if (jsonMatch && jsonMatch[1]) {
                try {
                    refinedParams = JSON.parse(jsonMatch[1].trim());
                    console.log('[refineStepArguments] Successfully extracted and parsed JSON from markdown:', refinedParams);
                } catch (nestedParseError) {
                    console.error('[refineStepArguments] Failed to parse extracted JSON.', nestedParseError);
                    throw new Error(`LLM output was not valid JSON, even after extraction: ${nestedParseError}`);
                }
            } else {
                console.error('[refineStepArguments] LLM output was not valid JSON and no JSON block found.');
                throw new Error('LLM output did not contain a valid JSON arguments object.');
            }
        }

        // Ensure refinedParams is actually an object
        if (typeof refinedParams !== 'object' || refinedParams === null) {
            throw new Error('Refined parameters from LLM is not a valid object.');
        }

        // 4. Construct the refined Call object
        const refinedCall: Call = {
            ...callToRefine,
            params: refinedParams // Use the refined parameters from the LLM
        };

        console.log('[refineStepArguments] Refinement successful. Returning refined call:', refinedCall);
        return refinedCall;

    } catch (error: any) {
        // 5. Handle errors
        console.error("[refineStepArguments] Error during LLM refinement call:", error);
        // Re-throw the error so the Orchestrator FSM can handle LLM_RESPONSE_FAILED
        throw new Error(`LLM refinement failed: ${error.message || error}`);
    }
} 