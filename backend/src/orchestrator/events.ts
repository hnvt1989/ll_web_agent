import { OrchestratorEvent, OrchestratorState, FsmContext, MAX_RETRIES } from './fsm';

// --- Assumed MCP Payload Structures ---
// These might need adjustment based on the actual Playwright-MCP implementation.

/**
 * Represents a successful result payload from the MCP server.
 */
interface McpResultPayload {
    type: 'RESULT';
    tool_call_id: string; // ID of the tool call this result corresponds to
    data?: any; // Optional data returned by the tool execution
}

/**
 * Represents an error payload from the MCP server.
 * Based on spec.md error handling section.
 */
interface McpErrorPayload {
    type: 'ERROR';
    tool_call_id: string; // ID of the tool call that failed
    code: 'ELEMENT_NOT_FOUND' | 'TIMEOUT' | 'EXECUTION_ERROR' | string; // Error codes (add more as needed)
    message: string;
}

// Type guard for MCP Result Payload
function isMcpResultPayload(payload: any): payload is McpResultPayload {
    return payload && payload.type === 'RESULT' && typeof payload.tool_call_id === 'string';
}

// Type guard for MCP Error Payload
function isMcpErrorPayload(payload: any): payload is McpErrorPayload {
    return payload && payload.type === 'ERROR' && typeof payload.tool_call_id === 'string' && typeof payload.code === 'string';
}

// Add JSON-RPC interfaces
interface JsonRpcSuccess {
    id: number;
    result: any;
}
interface JsonRpcError {
    id: number;
    error: { code: number; message: string; data?: any };
}

export function isJsonRpcSuccess(msg: any): msg is JsonRpcSuccess {
    // Ensure msg is an object before checking for properties
    return typeof msg === 'object' && msg !== null && 'result' in msg && typeof msg.id === 'number';
}
export function isJsonRpcError(msg: any): msg is JsonRpcError {
    // Ensure msg is an object before checking for properties
    return typeof msg === 'object' && msg !== null && 'error' in msg && typeof msg.id === 'number';
}

// --- Event Handlers ---

/**
 * Translates an MCP RESULT payload into the appropriate FSM event.
 * Requires FSM context to determine if it was the last step.
 *
 * @param payload The MCP RESULT payload.
 * @param context The current context of the FSM (needed for step counting).
 * @returns The corresponding OrchestratorEvent (STEP_SUCCESS_NEXT or STEP_SUCCESS_LAST).
 */
export function handleMcpResult(payload: McpResultPayload, context: Readonly<FsmContext>): OrchestratorEvent {
    console.log(`Handling MCP Result for tool_call_id: ${payload.tool_call_id}`);

    if (context.currentStepIndex >= context.totalSteps - 1) {
        // This was the last step planned
        console.log("Result received for the last step.");
        return OrchestratorEvent.STEP_SUCCESS_LAST;
    } else {
        // More steps remain
        console.log(`Result received for step ${context.currentStepIndex + 1}/${context.totalSteps}. More steps pending.`);
        return OrchestratorEvent.STEP_SUCCESS_NEXT;
    }
}

/**
 * Translates an MCP ERROR payload into the appropriate FSM event.
 * Currently maps all MCP errors recognized by the spec to STEP_FAILED.
 *
 * @param payload The MCP ERROR payload.
 * @param context The current context of the FSM (needed for retry logic check).
 * @returns The corresponding OrchestratorEvent (usually STEP_FAILED).
 */
export function handleMcpError(payload: McpErrorPayload, context: Readonly<FsmContext>): OrchestratorEvent {
     console.log(`Handling MCP Error: code=${payload.code}, message=${payload.message}, tool_call_id=${payload.tool_call_id}`);

     // According to spec.md, ELEMENT_NOT_FOUND and TIMEOUT should trigger retries (handled by STEP_FAILED event in FSM)
     switch (payload.code) {
        case 'ELEMENT_NOT_FOUND':
        case 'TIMEOUT':
        // Map other potential execution errors to STEP_FAILED as well
        case 'EXECUTION_ERROR':
            console.log(`Mapping MCP error code "${payload.code}" to STEP_FAILED.`);
            // The FSM's EXECUTE state handler for STEP_FAILED will check the retry count from context.
            return OrchestratorEvent.STEP_FAILED;
        default:
            // Handle unknown or unexpected error codes
            console.warn(`Received unhandled MCP error code: ${payload.code}. Mapping to STEP_FAILED.`);
            // Decide if truly unknown errors should immediately go to ERROR state or still use STEP_FAILED
             return OrchestratorEvent.STEP_FAILED; // Defaulting to STEP_FAILED for now
     }
}

// Interface defining the callback structure for handling tools/list response
interface PendingToolsListInfo {
    id: number | null;
    resolve: ((tools: any[] | undefined) => void) | null;
    reject: ((reason?: any) => void) | null;
}

/**
 * Generic handler that checks the payload type and calls the appropriate specific handler.
 *
 * @param mcpPayload The raw payload received from the MCP WebSocket.
 * @param context The current FSM context.
 * @returns The translated OrchestratorEvent or null (if message consumed by tools/list handler).
 */
export function translateMcpMessageToEvent(
    mcpPayload: unknown,
    context: Readonly<FsmContext>
): OrchestratorEvent | null {

    console.debug('[translateMcpMessageToEvent] Received raw SSE message:', JSON.stringify(mcpPayload));

    // Determine if last step based on context
    const isLastStep = context.currentStepIndex >= context.totalSteps - 1;

    // Callback for extracting references from event data, will be called externally by Orchestrator
    const extractRefsFromEvent = (handler?: (toolName: string, result: any) => void) => {
        if (!handler) return;
        
        // Extract from JSON-RPC success
        if (isJsonRpcSuccess(mcpPayload) && mcpPayload.result) {
            // The method might be in the result if it's structured that way
            const toolName = mcpPayload.result?.method || mcpPayload.result?.tool || 'unknown';
            handler(toolName, mcpPayload.result);
        }
        
        // Extract from legacy result format
        if (isMcpResultPayload(mcpPayload) && mcpPayload.data) {
            const toolName = mcpPayload.data?.method || mcpPayload.data?.tool || 'unknown';
            handler(toolName, mcpPayload.data);
        }
    };
    
    // Store the extraction function on the message object so it can be used by the orchestrator
    (mcpPayload as any)._extractRefs = extractRefsFromEvent;

    if (isJsonRpcSuccess(mcpPayload)) {
        console.log(`Handling success for call ID: ${mcpPayload.id}`);
        return isLastStep ? OrchestratorEvent.STEP_SUCCESS_LAST : OrchestratorEvent.STEP_SUCCESS_NEXT;
    } else if (isJsonRpcError(mcpPayload)) {
        console.log(`Handling error for call ID: ${mcpPayload.id}`, mcpPayload.error);
        return OrchestratorEvent.STEP_FAILED; // FSM handles retry logic / transition to ERROR
    } else if (isMcpResultPayload(mcpPayload)) {
        // Handle legacy RESULT type if needed
        console.log(`Handling legacy RESULT for tool_call_id: ${mcpPayload.tool_call_id}`);
        return isLastStep ? OrchestratorEvent.STEP_SUCCESS_LAST : OrchestratorEvent.STEP_SUCCESS_NEXT;
    } else if (isMcpErrorPayload(mcpPayload)) {
        // Handle legacy ERROR type if needed
         console.log(`Handling legacy ERROR: code=${mcpPayload.code}, message=${mcpPayload.message}, tool_call_id=${mcpPayload.tool_call_id}`);
        return OrchestratorEvent.STEP_FAILED;
    } else {
        console.warn("Received unknown or malformed message from MCP:", mcpPayload);
        return null; // Ignore unknown message types
    }
} 