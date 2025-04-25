// backend/src/orchestrator/Orchestrator.ts
import axios from 'axios';
import { OrchestratorFsm, OrchestratorState, OrchestratorEvent, FsmContext } from './fsm';
import * as EventSourceLib from 'eventsource';
import { parseInstruction } from '../parser/parseInstruction';
import { refineStepArgumentsWithSnapshot } from '../parser/refineStepArguments';
import { Call } from '../types/mcp';
// import logger from '../utils/logger';

// Define the structure for parsed tool call steps used internally
export interface McpToolCall { // Exported for fsm.ts
    tool_name: string;
    arguments: { [key: string]: any };
    tool_call_id?: string; // Optional ID from parser or unique internal ID
}

// Define the structure for MCP tool definitions
interface McpToolDefinition {
    name: string;
    description?: string;
    inputSchema: any; // Ideally, use a more specific JSON schema type
}

// Define the structure for session data managed by the orchestrator
interface SessionData {
    fsm: OrchestratorFsm;
    steps: McpToolCall[]; // This list might be updated with refined steps
    instruction: string | null;
    latestSnapshot: string | null; // Renamed from latestSnapshot for clarity
}

// Define the Orchestrator class
export class Orchestrator {
    private mcpServerBaseUrl: string;
    private endpointEs: EventSourceLib.EventSource | null = null;
    private sessionId: string | null = null;
    private sseUrl: string | null = null;
    private session: SessionData | null = null;
    private rpcIdCounter = 1;
    private dynamicToolMap: { [key: string]: string } = {};
    private confirmationTimerId: NodeJS.Timeout | null = null; // Timer ID management
    private static readonly CONFIRMATION_TIMEOUT_MS = 120000; // 2 minutes
    private pendingSnapshotTimer: NodeJS.Timeout | null = null; // Timer for awaiting snapshot
    private static readonly SNAPSHOT_TIMEOUT_MS = 20000; // 20 seconds

    constructor(mcpServerBaseUrl: string) {
        this.mcpServerBaseUrl = mcpServerBaseUrl;
        // Ensure env var default
        if (!('ALWAYS_GET_SNAPSHOT' in process.env)) {
            process.env.ALWAYS_GET_SNAPSHOT = 'false';
        }
    }

    private resetSession(finalState?: OrchestratorState): void {
        // logger.info(`[Orchestrator] Resetting session. Final state: ${finalState ?? 'Unknown'}`);
        console.log(`[Orchestrator] Resetting session. Final state: ${finalState ?? 'Unknown'}`);
        this.clearConfirmationTimer(); // Clear timer on session reset
        this.endpointEs?.close();
        this.endpointEs = null;
        this.sessionId = null;
        this.sseUrl = null;
        this.session = null; // Crucially, clear the session object
        this.rpcIdCounter = 1;
        this.dynamicToolMap = {};
        // TODO: Notify UI about session reset more explicitly if needed
    }

    /**
     * Initializes the connection with the MCP server, fetches tools, and gets a session ID.
     * (Implementation remains largely the same as before, focuses on setup)
     */
    private async initializeMcpSession(): Promise<{ sessionId: string; toolsList: McpToolDefinition[] | undefined }> {
        if (this.sessionId && this.endpointEs) {
            // logger.warn('[Orchestrator] Session already initialized.');
            console.warn('[Orchestrator] Session already initialized.');
            const toolsFromMap = Object.keys(this.dynamicToolMap).map(name => ({ name, inputSchema: {} }));
            return { sessionId: this.sessionId, toolsList: toolsFromMap.length > 0 ? toolsFromMap : undefined };
        }

        return new Promise((resolve, reject) => {
            // logger.info(`[Orchestrator] Establishing endpoint SSE to ${this.mcpServerBaseUrl} for sessionId & tools...`);
            console.log(`[Orchestrator] Establishing endpoint SSE to ${this.mcpServerBaseUrl} for sessionId & tools...`);
            let receivedSessionId = false;
            let receivedToolsList = false;
            let toolsListResult: McpToolDefinition[] | undefined = undefined;
            let toolsListReqId: number | null = null;
            let localSessionId: string | null = null;
            let localSseUrl: string | null = null;

            const EsConstructor = EventSourceLib.EventSource;
            this.endpointEs = new EsConstructor(this.mcpServerBaseUrl);

            const checkCompletion = () => {
                if (receivedSessionId && receivedToolsList) {
                    // logger.info('[Orchestrator] Received both sessionId and tools/list response.');
                    console.log('[Orchestrator] Received both sessionId and tools/list response.');
                    if (timeoutId) clearTimeout(timeoutId);
                    if (toolsListResult && Array.isArray(toolsListResult)) {
                        this.dynamicToolMap = toolsListResult.reduce((map, tool) => {
                            if (tool && typeof tool.name === 'string') { map[tool.name] = tool.name; }
                            return map;
                        }, {} as Record<string, string>);
                        // logger.info('[Orchestrator] Dynamic tool map populated:', this.dynamicToolMap);
                        console.log('[Orchestrator] Dynamic tool map populated:', this.dynamicToolMap);
                    } else {
                        // logger.warn('[Orchestrator] Tools list not available after session init.');
                        console.warn('[Orchestrator] Tools list not available after session init.');
                        this.dynamicToolMap = {};
                    }
                    resolve({ sessionId: localSessionId!, toolsList: toolsListResult });
                }
            };

            const failSession = (err: any) => {
                // logger.error({ err: err }, '[Orchestrator] Failed during initial session setup:');
                console.error('[Orchestrator] Failed during initial session setup:', { err: err });
                if (timeoutId) clearTimeout(timeoutId);
                this.endpointEs?.close();
                this.endpointEs = null;
                this.sessionId = null;
                this.sseUrl = null;
                this.dynamicToolMap = {};
                reject(err);
            };

            const timeoutId = setTimeout(() => failSession(new Error('Timeout waiting for sessionId and/or tools/list response')), 20000);

            if (!this.endpointEs) return failSession('Endpoint EventSource is null before addEventListener');

            this.endpointEs.addEventListener('endpoint', (ev) => {
                 if (receivedSessionId) return;
                 try {
                    const dataStr = (ev as any).data as string;
                    if (typeof dataStr === 'string' && dataStr.startsWith('/sse?sessionId=')) {
                        const sessionId = dataStr.split('sessionId=')[1]?.trim();
                        if (sessionId) {
                            // logger.info(`[Orchestrator] Obtained sessionId: ${sessionId}`);
                            console.log(`[Orchestrator] Obtained sessionId: ${sessionId}`);
                            localSessionId = sessionId;
                            localSseUrl = `${this.mcpServerBaseUrl}${dataStr}`;
                            this.sessionId = localSessionId;
                            this.sseUrl = localSseUrl;
                            receivedSessionId = true;

                            // --- Attach General Message Handler for MCP Responses ---
                            // logger.info(`[Orchestrator] Attaching general message handler to ${localSseUrl}`);
                            console.log(`[Orchestrator] Attaching general message handler to ${localSseUrl}`);
                            this.endpointEs!.addEventListener('message', (msgEvent) => {
                                try {
                                    const msgData = JSON.parse((msgEvent as any).data);
                                    // logger.info(`[Orchestrator] Received SSE message:`, JSON.stringify(msgData));
                                    console.log(`[Orchestrator] Received SSE message:`, JSON.stringify(msgData));

                                    if (msgData.jsonrpc === '2.0' && msgData.id !== undefined) {
                                        // It's a JSON-RPC response related to a step execution
                                        const isError = this.isJsonRpcError(msgData);
                                        const responsePayload = {
                                            stepId: msgData.id,
                                            snapshot: undefined as string | undefined,
                                            error: isError ? msgData.error : null,
                                        };

                                        if (!isError && this.isJsonRpcSuccess(msgData)) {
                                            const result = msgData.result;
                                             // Check if MCP result indicates an operational error
                                            if (result?.isError === true) {
                                                // logger.error({ err: result.content }, `[Orchestrator] Step Execution Error (ID: ${msgData.id}):`);
                                                console.error(`[Orchestrator] Step Execution Error (ID: ${msgData.id}):`, { err: result.content });
                                                responsePayload.error = { message: result.content || 'Step failed with isError=true', code: -32000 }; // Use generic code
                                            } else {
                                                // Look for snapshot embedded in 'text' type content
                                                const textContentItem = result?.content?.find((item: any) => item.type === 'text');
                                                if (textContentItem && textContentItem.text?.includes('- Page Snapshot')) {
                                                    responsePayload.snapshot = textContentItem.text;
                                                    // logger.info('[Orchestrator] Found snapshot in MCP response.');
                                                    console.log('[Orchestrator] Found snapshot in MCP response.');
                                                } else {
                                                     // Set to undefined if not found, aligning with type
                                                     responsePayload.snapshot = undefined; 
                                                     // logger.info('[Orchestrator] No snapshot found in MCP response text.');
                                                     console.log('[Orchestrator] No snapshot found in MCP response text.');
                                                }
                                            }
                                        } else if (isError) {
                                             // logger.error({ err: msgData.error }, `[Orchestrator] Received JSON-RPC Error (ID: ${msgData.id}):`);
                                             console.error(`[Orchestrator] Received JSON-RPC Error (ID: ${msgData.id}):`, { err: msgData.error });
                                        }

                                        // Dispatch MCP_RESPONSE_RECEIVED to FSM
                                        // Check if session and FSM still exist before dispatching
                                        if (this.session?.fsm) {
                                             // logger.info(`[Orchestrator] Dispatching MCP_RESPONSE_RECEIVED to FSM for ID: ${msgData.id}`);
                                             console.log(`[Orchestrator] Dispatching MCP_RESPONSE_RECEIVED to FSM for ID: ${msgData.id}`);
                                             this.session.fsm.dispatch(OrchestratorEvent.MCP_RESPONSE_RECEIVED, responsePayload);
                                        } else {
                                             // logger.warn(`[Orchestrator] Received MCP response (ID: ${msgData.id}) but no active session/FSM to dispatch to.`);
                                             console.warn(`[Orchestrator] Received MCP response (ID: ${msgData.id}) but no active session/FSM to dispatch to.`);
                                        }

                                    } else {
                                        // logger.warn('[Orchestrator] Received non-JSON-RPC SSE message or message without ID:', msgData);
                                        console.warn('[Orchestrator] Received non-JSON-RPC SSE message or message without ID:', msgData);
                                    }
                                } catch (parseError: any) {
                                    // logger.error({ err: parseError, data: (msgEvent as any).data }, '[Orchestrator] Error parsing SSE message data:');
                                    console.error('[Orchestrator] Error parsing SSE message data:', { err: parseError, data: (msgEvent as any).data });
                                }
                            });
                            // --- End General Message Handler ---

                            // Immediately request tools list
                            toolsListReqId = this.rpcIdCounter++;
                            // logger.info(`[Orchestrator] Sending tools/list request (ID: ${toolsListReqId}) via POST to ${localSseUrl}...`);
                            console.log(`[Orchestrator] Sending tools/list request (ID: ${toolsListReqId}) via POST to ${localSseUrl}...`);
                            axios.post(localSseUrl!, { jsonrpc: '2.0', id: toolsListReqId, method: 'tools/list', params: {} },
                                { headers: { 'Content-Type': 'application/json' }, timeout: 10000 })
                                .then(response => {
                                    if (this.isJsonRpcSuccess(response.data) && response.data.id === toolsListReqId) {
                                        // logger.info('[Orchestrator] tools/list responded synchronously. Processing result...');
                                        console.log('[Orchestrator] tools/list responded synchronously. Processing result...');
                                        toolsListResult = response.data.result?.tools;
                                        receivedToolsList = true;
                                        checkCompletion();
                                    } else if (response.status === 202 || (typeof response.data === 'string' && response.data.toLowerCase().includes('accepted'))) {
                                        // logger.info(`[Orchestrator] tools/list (ID: ${toolsListReqId}) acknowledged. Waiting on endpointEs stream...`);
                                        console.log(`[Orchestrator] tools/list (ID: ${toolsListReqId}) acknowledged. Waiting on endpointEs stream...`);
                                    } else {
                                        // logger.warn('[Orchestrator] Unexpected sync response for tools/list:', response.data);
                                        console.warn('[Orchestrator] Unexpected sync response for tools/list:', response.data);
                                        receivedToolsList = true; checkCompletion();
                                    }
                                })
                                .catch(postError => {
                                    // logger.error({ err: postError }, '[Orchestrator] CRITICAL: Failed to POST tools/list request:');
                                    console.error('[Orchestrator] CRITICAL: Failed to POST tools/list request:', { err: postError });
                                    failSession(postError);
                                });
                            checkCompletion(); // Check if session ID was already received
                        }
                     }
                 } catch (parseErr) {
                      // logger.error({ err: parseErr }, '[Orchestrator] Error parsing endpoint event:');
                      console.error('[Orchestrator] Error parsing endpoint event:', { err: parseErr });
                 }
            });

            if (!this.endpointEs) return failSession('Endpoint EventSource is null before onmessage');
            this.endpointEs.onmessage = (ev) => {
                // Handle async tools/list response specifically
                // logger.debug('[initializeMcpSession] Received message on endpointEs:', ev.data);
                console.debug('[initializeMcpSession] Received message on endpointEs:', ev.data);
                try {
                    const msg = JSON.parse(ev.data);
                    if (!receivedToolsList && toolsListReqId !== null && this.isJsonRpcSuccess(msg) && msg.id === toolsListReqId) {
                        // logger.info('[Orchestrator] Received async tools/list response via endpointEs.');
                        console.log('[Orchestrator] Received async tools/list response via endpointEs.');
                        toolsListResult = msg.result?.tools;
                        receivedToolsList = true;
                        checkCompletion();
                    } else if (!receivedToolsList && toolsListReqId !== null && this.isJsonRpcError(msg) && msg.id === toolsListReqId) {
                        // logger.error({ err: msg.error }, '[Orchestrator] Received async tools/list error via endpointEs:');
                        console.error('[Orchestrator] Received async tools/list error via endpointEs:', { err: msg.error });
                        toolsListResult = undefined; receivedToolsList = true; checkCompletion();
                    }
                } catch (e) {
                     // logger.warn('[initializeMcpSession] Failed to parse message on endpointEs:', ev.data, e);
                     console.warn('[initializeMcpSession] Failed to parse message on endpointEs:', ev.data, e);
                }
            };

            if (!this.endpointEs) return failSession('Endpoint EventSource is null before onerror');
            this.endpointEs.onerror = (err) => failSession(err);
        });
    }

    // --- JSON-RPC Type Guards (Unchanged) ---
    private isJsonRpcSuccess(response: any): response is { jsonrpc: '2.0'; id: number | string; result: any } { 
        // Added return statement to fix linter error
        return response && response.jsonrpc === '2.0' && response.id !== undefined && response.result !== undefined && response.error === undefined; 
    }
    private isJsonRpcError(response: any): response is { jsonrpc: '2.0'; id: number | string | null; error: { code: number; message: string; data?: any } } { 
        // Added return statement to fix linter error
        return response && response.jsonrpc === '2.0' && response.id !== undefined && response.error !== undefined;
    }


    /**
     * Sends a step execution request to the MCP server. Does not wait for completion,
     * relies on the SSE handler to receive the result and dispatch to FSM.
     * @param stepIndex The index of the step being executed.
     * @param step The step object (McpToolCall) to execute.
     */
    private async executeStep(stepIndex: number, step: McpToolCall): Promise<void> {
        if (!this.sessionId || !this.sseUrl) {
            // logger.error(`[Orchestrator] Cannot execute step ${stepIndex + 1}: Session not initialized.`);
            console.error(`[Orchestrator] Cannot execute step ${stepIndex + 1}: Session not initialized.`);
            // Dispatch failure immediately to FSM
            this.session?.fsm.dispatch(OrchestratorEvent.STEP_FAILED, {
                stepId: step.tool_call_id ?? `step_${stepIndex}`,
                error: { code: -32002, message: 'Session not initialized' }
            });
            return;
        }

        const requestId = this.rpcIdCounter++; // Use internal counter for request ID
        // Associate request ID with the step if needed for tracking, but MCP uses its own flow
        const rpcRequest = {
            jsonrpc: '2.0',
            id: requestId,
            method: 'tools/call',
            params: {
                name: step.tool_name,
                arguments: step.arguments
            }
        };

        // logger.info(`[Orchestrator] Sending step ${stepIndex + 1} (Request ID: ${requestId}): ${step.tool_name}`, rpcRequest.params);
        console.log(`[Orchestrator] Sending step ${stepIndex + 1} (Request ID: ${requestId}): ${step.tool_name}`, rpcRequest.params);

        try {
            const response = await axios.post(this.sseUrl, rpcRequest, {
                headers: { 'Content-Type': 'application/json' },
                timeout: 15000 // Timeout for the POST acknowledgment only
            });

            if (response.status >= 200 && response.status < 300) {
                console.log(`[Orchestrator] Step ${stepIndex + 1} (Request ID: ${requestId}) acknowledged by MCP (Status: ${response.status}). Waiting for SSE response.`);
                this.setupSnapshotTimer();
            } else {
                // Immediate failure based on POST response
                // logger.warn(`[Orchestrator] Unexpected acknowledgment status for step ${stepIndex + 1} (Request ID: ${requestId}): ${response.status}. Dispatching STEP_FAILED.`);
                console.warn(`[Orchestrator] Unexpected acknowledgment status for step ${stepIndex + 1} (Request ID: ${requestId}): ${response.status}. Dispatching STEP_FAILED.`);
                this.session?.fsm.dispatch(OrchestratorEvent.STEP_FAILED, {
                    stepId: requestId,
                    error: { code: -32004, message: `Unexpected MCP acknowledgment: ${response.status}` }
                });
            }
        } catch (error: any) {
            // logger.error({ err: error }, `[Orchestrator] Failed to POST step ${stepIndex + 1} (Request ID: ${requestId}) execution request:`);
            console.error(`[Orchestrator] Failed to POST step ${stepIndex + 1} (Request ID: ${requestId}) execution request:`, { err: error });
            this.session?.fsm.dispatch(OrchestratorEvent.STEP_FAILED, {
                stepId: requestId,
                error: { code: -32004, message: `Failed to send command: ${error.message}` }
            });
        }
    }

    /**
     * Handles updates from the FSM, triggering actions like executing steps
     * or refining arguments based on the new state and context.
     * @param newState The new state of the FSM.
     * @param context The context associated with the new state.
     */
    async handleFsmUpdate(newState: OrchestratorState, context: Readonly<FsmContext>): Promise<void> {
        // logger.info(`[Orchestrator] FSM State Updated: ${newState}, Current Step Index: ${context.currentStepIndex}`);
        console.log(`[Orchestrator] FSM State Updated: ${newState}, Current Step Index: ${context.currentStepIndex}`);
        // logger.debug('[Orchestrator] FSM Context:', context); // Uncomment for detailed context logging

        // --- Manage Confirmation Timer ---
        if (newState === OrchestratorState.WAIT_CONFIRM) {
            this.startConfirmationTimer();
        } else {
            // Clear timer if entering any state other than WAIT_CONFIRM
            this.clearConfirmationTimer();
        }
        // --- End Timer Management ---

        switch (newState) {
            case OrchestratorState.IDLE:
                // logger.info('[Orchestrator] Session is IDLE.');
                console.log('[Orchestrator] Session is IDLE.');
                // Reset might have already happened in FSM transition, or do final cleanup here.
                // Ensure timer is cleared if not already.
                this.clearConfirmationTimer();
                break;

            case OrchestratorState.WAIT_CONFIRM:
                // logger.info(`[Orchestrator] Now waiting for user confirmation for step ${context.currentStepIndex + 1}.`);
                console.log(`[Orchestrator] Now waiting for user confirmation for step ${context.currentStepIndex + 1}.`);
                // Log the step details being confirmed
                if (context.stepToConfirm) {
                     // logger.info(`[Orchestrator] Step details: ${context.stepToConfirm.tool_name}`, context.stepToConfirm.arguments);
                     console.log(`[Orchestrator] Step details: ${context.stepToConfirm.tool_name}`, context.stepToConfirm.arguments);
                } else {
                     // logger.error('[Orchestrator] FSM entered WAIT_CONFIRM but context.stepToConfirm is null! This indicates a potential logic error.');
                     console.error('[Orchestrator] FSM entered WAIT_CONFIRM but context.stepToConfirm is null! This indicates a potential logic error.');
                     // Consider dispatching an error event back to FSM
                     this.session?.fsm.dispatch(OrchestratorEvent.STEP_FAILED, { error: 'Internal error: stepToConfirm missing in WAIT_CONFIRM' });
                }
                // UI should observe this state via /api/status and display context.stepToConfirm
                break;

            case OrchestratorState.EXECUTE:
                // logger.info(`[Orchestrator] FSM requests execution for step ${context.currentStepIndex + 1}.`);
                console.log(`[Orchestrator] FSM requests execution for step ${context.currentStepIndex + 1}.`);
                if (this.session && context.currentStepIndex >= 0 && context.currentStepIndex < context.totalSteps) {
                    const stepToExecute = this.session.steps[context.currentStepIndex];
                    if (stepToExecute) {
                        // Call executeStep (fire-and-forget style, wait for SSE)
                        this.executeStep(context.currentStepIndex, stepToExecute);
                        // FSM should ideally wait for MCP_RESPONSE_RECEIVED event now.
                        // Consider adding WAIT_MCP_RESPONSE state if needed for clearer flow.
                    } else {
                         // logger.error(`[Orchestrator] Cannot execute step: Step at index ${context.currentStepIndex} not found in session data.`);
                         console.error(`[Orchestrator] Cannot execute step: Step at index ${context.currentStepIndex} not found in session data.`);
                         this.session.fsm.dispatch(OrchestratorEvent.STEP_FAILED, { error: 'Internal error: Step not found for execution' });
                    }
                } else {
                    // logger.error('[Orchestrator] Invalid context for EXECUTE state (missing session, invalid index).');
                    console.error('[Orchestrator] Invalid context for EXECUTE state (missing session, invalid index).');
                    this.session?.fsm.dispatch(OrchestratorEvent.STEP_FAILED, { error: 'Internal error: Invalid context for execution trigger' });
                }
                break;

             case OrchestratorState.WAIT_MCP_RESPONSE:
                // This state can be added to FSM if we want explicit waiting period after sending command to MCP
                // logger.info(`[Orchestrator] Waiting for MCP response/snapshot for step ${context.currentStepIndex + 1}.`);
                console.log(`[Orchestrator] Waiting for MCP response/snapshot for step ${context.currentStepIndex + 1}.`);
                // No action needed here; waiting for SSE handler to dispatch MCP_RESPONSE_RECEIVED
                break;

            case OrchestratorState.WAIT_LLM_RESPONSE:
                 // logger.info(`[Orchestrator] FSM requests LLM refinement for step ${context.currentStepIndex + 1}.`);
                 console.log(`[Orchestrator] FSM requests LLM refinement for step ${context.currentStepIndex + 1}.`);
                 if (this.session &&
                     context.currentStepIndex >= 0 &&
                     context.currentStepIndex < context.totalSteps &&
                     context.latestSnapshot &&
                     this.session.steps[context.currentStepIndex]) {
                     const stepToRefine = this.session.steps[context.currentStepIndex];
                     const snapshot = context.latestSnapshot;
                     try {
                         // Construct the 'Call' object for the refinement function
                         const callToRefine: Call = {
                            type: 'call',
                            id: Date.now(), // Use timestamp for ID (number)
                            method: stepToRefine.tool_name,
                            params: stepToRefine.arguments
                         };
                         // logger.info(`[Orchestrator] Calling refineStepArgumentsWithSnapshot with snapshot (length: ${snapshot.length}) and step:`, callToRefine);
                         console.log(`[Orchestrator] Calling refineStepArgumentsWithSnapshot with snapshot (length: ${snapshot.length}) and step:`, callToRefine);

                         // Call the refinement function (ensure it exists and works)
                         const refinedCall = await refineStepArgumentsWithSnapshot(callToRefine, snapshot);

                         // Map the refined Call back to McpToolCall structure
                         const refinedMcpStep: McpToolCall = {
                            tool_name: refinedCall.method,
                            arguments: refinedCall.params as { [key: string]: any; },
                            tool_call_id: stepToRefine.tool_call_id // Preserve original ID if possible
                         };
                         // logger.info(`[Orchestrator] LLM refinement successful. Refined step:`, refinedMcpStep);
                         console.log(`[Orchestrator] LLM refinement successful. Refined step:`, refinedMcpStep);
                         // Dispatch success event with the refined step
                         this.session.fsm.dispatch(OrchestratorEvent.LLM_RESPONSE_RECEIVED, { refinedStep: refinedMcpStep });
                     } catch (refinementError: any) {
                         // logger.error({ err: refinementError }, `[Orchestrator] LLM refinement failed for step ${context.currentStepIndex + 1}.`);
                         console.error(`[Orchestrator] LLM refinement failed for step ${context.currentStepIndex + 1}.`, { err: refinementError });
                         // Dispatch failure event
                         this.session.fsm.dispatch(OrchestratorEvent.LLM_RESPONSE_FAILED, { error: refinementError });
                     }
                 } else {
                     // logger.error('[Orchestrator] Invalid context for WAIT_LLM_RESPONSE state (missing session, index, step, or snapshot).');
                     console.error('[Orchestrator] Invalid context for WAIT_LLM_RESPONSE state (missing session, index, step, or snapshot).');
                     this.session?.fsm.dispatch(OrchestratorEvent.LLM_RESPONSE_FAILED, { error: 'Internal error: Invalid context for refinement trigger' });
                 }
                 break;

            case OrchestratorState.ERROR:
                // logger.error(`[Orchestrator] Session entered ERROR state. Last error:`, context.lastError ?? 'Unknown error');
                console.error(`[Orchestrator] Session entered ERROR state. Last error:`, context.lastError ?? 'Unknown error');
                // Ensure cleanup happens
                this.resetSession(OrchestratorState.ERROR);
                break;

            default:
                // Exhaustive check for unhandled states (good practice with enums)
                const _exhaustiveCheck: never = newState;
                // logger.warn(`[Orchestrator] Unhandled FSM state reached: ${_exhaustiveCheck}`);
                console.warn(`[Orchestrator] Unhandled FSM state reached: ${_exhaustiveCheck}`);
        }
    }


    /**
     * Starts a new session, parses the instruction, and prepares the FSM.
     * @param instruction The natural language instruction from the user.
     * @returns A promise that resolves with the initial list of parsed steps.
     * @throws An error if session initialization or parsing fails.
     */
    public async startSession(instruction: string): Promise<{ steps: McpToolCall[] }> {
        if (this.session) {
            // logger.warn('[Orchestrator] Session already active. Resetting before starting new one.');
            console.warn('[Orchestrator] Session already active. Resetting before starting new one.');
            this.resetSession(); // Reset existing session first
        }

        // logger.info(`[Orchestrator] Starting new session for instruction: "${instruction}"`);
        console.log(`[Orchestrator] Starting new session for instruction: "${instruction}"`);

        try {
            // 1. Initialize connection with MCP to get session ID and tools list
            const { sessionId, toolsList } = await this.initializeMcpSession();
            // logger.info(`[Orchestrator] MCP Session initialized. Session ID: ${sessionId}`);
            console.log(`[Orchestrator] MCP Session initialized. Session ID: ${sessionId}`);

            if (!toolsList || toolsList.length === 0) {
                 // logger.error('[Orchestrator] Failed to retrieve tools list from MCP.');
                 console.error('[Orchestrator] Failed to retrieve tools list from MCP.');
                 throw new Error('Failed to retrieve tools list from MCP.');
            }

            // 2. Create and setup the FSM instance with the update handler
            const fsm = new OrchestratorFsm((newState, context) => {
                // Use a bound method to handle async updates and catch errors
                this.handleFsmUpdate(newState, context).catch(err => {
                    // logger.error({ err }, "[Orchestrator] CRITICAL Error in async handleFsmUpdate execution:");
                    console.error("[Orchestrator] CRITICAL Error in async handleFsmUpdate execution:", { err });
                    // Ensure session reset happens even if handleFsmUpdate fails
                    this.resetSession(OrchestratorState.ERROR);
                });
            });

            // 3. Initialize session data object
            this.session = {
                fsm,
                steps: [], // Steps populated after parsing
                instruction,
                latestSnapshot: null, // Initialize snapshot
            };

            // 4. Parse the instruction using the fetched tools
            // logger.info('[Orchestrator] Parsing instruction...');
            console.log('[Orchestrator] Parsing instruction...');
            // Ensure parser does NOT add initial snapshot anymore
            const parsedSteps = await parseInstruction(instruction, toolsList);
            // logger.info(`[Orchestrator] Instruction parsed into ${parsedSteps.length} steps.`);
            console.log(`[Orchestrator] Instruction parsed into ${parsedSteps.length} steps.`);
            // logger.debug('[Orchestrator] Parsed Steps:', JSON.stringify(parsedSteps, null, 2)); // Verbose

            // 5. Update session steps and dispatch PARSING_COMPLETE to FSM
            // Ensure steps have unique IDs if parser doesn't provide them
            this.session.steps = parsedSteps.map((step, index) => ({
                 ...step,
                 tool_call_id: step.tool_call_id || `step_${index}_${Date.now()}` // Assign unique ID
            }));

            // Dispatch event to FSM to kick off the process
            fsm.dispatch(OrchestratorEvent.PARSING_COMPLETE, { steps: this.session.steps });

            // 6. Return the initial parsed steps to the caller (server.ts)
            // Note: Filtering snapshot steps happens in server.ts before sending to UI
            return { steps: this.session.steps };

        } catch (error: any) {
            // logger.error({ err: error }, '[Orchestrator] Failed to start session or parse instruction.');
            console.error('[Orchestrator] Failed to start session or parse instruction.', { err: error });
            this.resetSession(OrchestratorState.ERROR); // Ensure reset on any failure during startup
            throw new Error(`Session initialization failed: ${error.message}`); // Re-throw for server.ts
        }
    }

     // --- Timer Management ---
    private startConfirmationTimer() {
        this.clearConfirmationTimer(); // Clear existing timer first
        // logger.info(`[Orchestrator] Starting confirmation timer (${Orchestrator.CONFIRMATION_TIMEOUT_MS}ms).`);
        console.log(`[Orchestrator] Starting confirmation timer (${Orchestrator.CONFIRMATION_TIMEOUT_MS}ms).`);
        this.confirmationTimerId = setTimeout(() => {
            // logger.warn('[Orchestrator] Confirmation timer expired. Cancelling session.');
            console.warn('[Orchestrator] Confirmation timer expired. Cancelling session.');
            this.confirmationTimerId = null; // Clear the ID before dispatching
            // Dispatch CANCEL_SESSION to FSM when timer expires
            this.session?.fsm.dispatch(OrchestratorEvent.CANCEL_SESSION, { reason: 'Confirmation timeout' });
        }, Orchestrator.CONFIRMATION_TIMEOUT_MS);
    }

    private clearConfirmationTimer() {
        if (this.confirmationTimerId) {
            // logger.info('[Orchestrator] Clearing confirmation timer.');
            console.log('[Orchestrator] Clearing confirmation timer.');
            clearTimeout(this.confirmationTimerId);
            this.confirmationTimerId = null;
        }
    }

    private clearPendingSnapshotTimer() {
        if (this.pendingSnapshotTimer) {
            clearTimeout(this.pendingSnapshotTimer);
            this.pendingSnapshotTimer = null;
        }
    }

    private setupSnapshotTimer() {
        if (process.env.ALWAYS_GET_SNAPSHOT === 'true') {
            this.clearPendingSnapshotTimer();
            this.pendingSnapshotTimer = setTimeout(() => {
                console.log('[Orchestrator] Snapshot timeout reached. Requesting explicit browser_snapshot.');
                this.requestSnapshot().catch(err => console.error('[Orchestrator] Failed to request snapshot:', err));
            }, Orchestrator.SNAPSHOT_TIMEOUT_MS);
        }
    }

    private async requestSnapshot(): Promise<void> {
        if (!this.sseUrl) return;
        const snapshotReqId = this.rpcIdCounter++;
        const snapshotRequest = {
            jsonrpc: '2.0',
            id: snapshotReqId,
            method: 'tools/call',
            params: { name: 'browser_snapshot', arguments: {} }
        };
        console.log(`[Orchestrator] Sending browser_snapshot request (ID: ${snapshotReqId})`);
        try {
            await axios.post(this.sseUrl, snapshotRequest, { headers: { 'Content-Type': 'application/json' }, timeout: 15000 });
        } catch (err) {
            console.error('[Orchestrator] Error sending browser_snapshot request:', err);
        }
    }

    // --- Public Methods for Server Interaction (Interfaces remain the same) ---

    /** Handles user confirmation by dispatching CONFIRM_STEP to the FSM. */
    public handleConfirmStep(): void {
        if (!this.session) {
            // logger.warn('[Orchestrator] Cannot confirm step: No active session.');
            console.warn('[Orchestrator] Cannot confirm step: No active session.');
            throw new Error('No active session to confirm.'); // Let server handle error response
        }
        // logger.info('[Orchestrator] Dispatching CONFIRM_STEP to FSM.');
        console.log('[Orchestrator] Dispatching CONFIRM_STEP to FSM.');
        this.session.fsm.dispatch(OrchestratorEvent.CONFIRM_STEP);
    }

    /** Handles user rejection by dispatching REJECT_STEP to the FSM. */
    public handleRejectStep(): void {
        if (!this.session) {
            // logger.warn('[Orchestrator] Cannot reject step: No active session.');
            console.warn('[Orchestrator] Cannot reject step: No active session.');
            return; // Or throw error if needed
        }
        // logger.info('[Orchestrator] Dispatching REJECT_STEP to FSM.');
        console.log('[Orchestrator] Dispatching REJECT_STEP to FSM.');
        this.session.fsm.dispatch(OrchestratorEvent.REJECT_STEP);
    }

    /** Handles user cancellation by dispatching CANCEL_SESSION to the FSM. */
    public handleCancelSession(): void {
        if (!this.session) {
            // logger.warn('[Orchestrator] Cannot cancel session: No active session.');
            console.warn('[Orchestrator] Cannot cancel session: No active session.');
            return; // Or throw error if needed
        }
        // logger.info('[Orchestrator] Dispatching CANCEL_SESSION to FSM.');
        console.log('[Orchestrator] Dispatching CANCEL_SESSION to FSM.');
        this.session.fsm.dispatch(OrchestratorEvent.CANCEL_SESSION);
    }

    /** Returns the current status (state and context) for the UI. */
    public getStatus(): { state: OrchestratorState; context: Readonly<FsmContext> } {
        if (!this.session || !this.session.fsm) {
            // Return default IDLE state if no session
             const idleContext: FsmContext = {
                retryCount: 0, currentStepIndex: -1, totalSteps: 0,
                steps: [], latestSnapshot: null, stepToConfirm: null, lastError: null
            };
            return { state: OrchestratorState.IDLE, context: idleContext };
        }
        // Return current state and context from the active FSM
        return { state: this.session.fsm.getCurrentState(), context: this.session.fsm.getContext() };
    }

    // --- Getters (If needed) ---
    public get currentSessionId(): string | null {
        return this.sessionId;
    }
}