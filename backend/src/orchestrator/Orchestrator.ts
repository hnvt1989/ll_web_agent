import { OrchestratorFsm, OrchestratorState, OrchestratorEvent, FsmContext } from './fsm';
import { McpSseClient } from '../mcp/socket';
import { McpMessage, Result, Error as McpError } from '../types/mcp';
import { parseInstruction } from '../parser/parseInstruction';
// Import the function to translate MCP messages to FSM events
import { translateMcpMessageToEvent } from './events'; 
import axios from 'axios';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const EventSourceLib = require('eventsource');
import EventSource from 'eventsource';

// Define the structure for an MCP tool call (align with parser)
interface McpToolCall {
    tool_name: string;
    arguments: { [key: string]: any };
    tool_call_id?: string;
}

// Map logical tool names to MCP browser tool names
const TOOL_NAME_MAP: Record<string, string> = {
    navigate: 'browser_navigate',
    search: 'browser_search',
    click: 'browser_click',
    type: 'browser_type',
    scroll: 'browser_scroll',
    assert_text: 'browser_assert_text',
    dismiss_modal: 'browser_dismiss_modal'
};

// Define the structure for session data managed by the orchestrator
interface SessionData {
    fsm: OrchestratorFsm;
    steps: McpToolCall[];
    instruction: string | null;
}

export class Orchestrator {
    private mcpClient: McpSseClient | null = null;
    private session: SessionData | null = null;
    private mcpServerBaseUrl: string;
    private sessionId: string | null = null; // Add state for sessionId
    private sseUrl: string | null = null;
    private rpcIdCounter: number = 1;
    private endpointEs: EventSource | null = null;

    // Make constructor async to handle session initialization
    // Note: This might have implications if Orchestrator is instantiated synchronously elsewhere.
    // Consider moving initialization to a separate async method if needed.
    constructor(mcpServerBaseUrl: string) {
        this.mcpServerBaseUrl = mcpServerBaseUrl;
        // Session ID initialization now happens separately, maybe call initializeMcpSession() explicitly after construction?
        // Or handle lazily before first call in executeStep? For simplicity, let's try lazy init in executeStep for now.
    }
    
    // Async function to initialize the MCP session and get the ID via SSE 'endpoint' event
    private async initializeMcpSession(): Promise<string | null> {
        if (this.sessionId) {
            return this.sessionId; // Already initialized
        }

        console.log(`[Orchestrator] Establishing endpoint SSE connection to ${this.mcpServerBaseUrl} to obtain sessionId...`);

        return new Promise<string | null>((resolve, reject) => {
            try {
                // Use EventSource to connect to the base URL
                const EsConstructor = EventSourceLib.EventSource;
                this.endpointEs = new EsConstructor(this.mcpServerBaseUrl);

                // Timeout safeguard (e.g., 60s)
                const timeoutId = setTimeout(() => {
                    console.error('[Orchestrator] Timeout waiting for endpoint event with sessionId.');
                    this.endpointEs?.close();
                    this.endpointEs = null;
                    reject(new Error('Timeout waiting for sessionId'));
                }, 60000);

                // Listen for the custom SSE event named 'endpoint'
                if (this.endpointEs) {
                    this.endpointEs.addEventListener('endpoint', (ev: MessageEvent) => {
                        try {
                            const dataStr = (ev as any).data as string;
                            if (typeof dataStr === 'string' && dataStr.startsWith('/sse?sessionId=')) {
                                const sessionId = dataStr.split('sessionId=')[1];
                                if (sessionId) {
                                    clearTimeout(timeoutId);
                                    this.sessionId = sessionId.trim();
                                    this.sseUrl = `${this.mcpServerBaseUrl}${dataStr}`; // full URL for POST/SSE
                                    console.log(`[Orchestrator] Obtained sessionId: ${this.sessionId}`);
                                    resolve(this.sessionId);
                                }
                            }
                        } catch (parseErr) {
                            console.error('[Orchestrator] Failed parsing endpoint event:', parseErr);
                        }
                    });
                }

                if (this.endpointEs) {
                    this.endpointEs.onerror = (err: any) => {
                        clearTimeout(timeoutId);
                        console.error('[Orchestrator] Error on endpoint SSE connection:', err);
                        this.endpointEs?.close();
                        this.endpointEs = null;
                        reject(err);
                    };
                }
            } catch (err) {
                reject(err);
            }
        });
    }

    // Create the SSE client after obtaining sessionId and send initialize RPC
    private async createSseClient(): Promise<void> {
        if (this.mcpClient) {
            return; // already created
        }

        if (!this.sessionId) {
            console.error('[Orchestrator] Cannot create SSE client: sessionId missing.');
            return;
        }

        // Build SSE URL with sessionId as query param (no trailing /sse here, server expects /sse)
        this.sseUrl = `${this.mcpServerBaseUrl}/sse?sessionId=${this.sessionId}`;

        // Prepare initialize payload
        const initPayload = {
            jsonrpc: '2.0',
            id: this.rpcIdCounter++,
            method: 'initialize',
            params: {
                protocolVersion: '2024-05-01',
                clientInfo: {
                    name: 'll-web-agent-backend',
                    version: '0.1.0'
                },
                capabilities: {
                    tools: {},
                    resources: {},
                    logging: { levels: ['info', 'warn', 'error'] }
                }
            }
        };

        // Send initialize via POST to SSE endpoint
        try {
            console.log(`[Orchestrator] Sending initialize RPC to ${this.sseUrl}`);
            await axios.post(this.sseUrl, initPayload, { headers: { 'Content-Type': 'application/json' }, timeout: 10000 });
        } catch (error: any) {
            console.error('[Orchestrator] Failed to send initialize RPC:', error.message);
            return;
        }

        // Create SSE client instance once initialization succeeds
        this.mcpClient = new McpSseClient(this.sseUrl);

        this.mcpClient.on('open', () => {
            console.log('[Orchestrator] MCP SSE Client Connected.');
        });

        this.mcpClient.on('message', (message: McpMessage) => {
            if (this.session) {
                const event = translateMcpMessageToEvent(message, this.session.fsm.getContext());
                if (event) {
                    this.session.fsm.dispatch(event);
                    this.handleStateChange(this.session.fsm.getCurrentState(), this.session.fsm.getContext());
                }
            }
        });

        this.mcpClient.on('close', () => {
            console.log('[Orchestrator] MCP SSE Client Closed.');
            if (this.session) {
                this.resetSession(OrchestratorState.IDLE);
            }
        });

        this.mcpClient.on('error', (err: Event) => {
            console.error('[Orchestrator] MCP SSE Client Error:', err);
            if (this.session) {
                this.resetSession(OrchestratorState.ERROR);
            }
        });

        this.mcpClient.connect();
    }

    // Method to handle FSM state updates
    private onStateUpdate(newState: OrchestratorState, context: FsmContext): void {
        console.log(`[Orchestrator] FSM State Changed: ${newState}, Context:`, context);
        this.handleStateChange(newState, context);
    }

    // Method to handle actions based on the new state
    private handleStateChange(newState: OrchestratorState, context: FsmContext): void {
        // Perform actions based on the *new* state the FSM transitioned *to*
        switch (newState) {
            case OrchestratorState.EXECUTE:
                if (this.session) {
                     this.executeStep(context.currentStepIndex);
                }
                break;
            case OrchestratorState.IDLE:
                 // Session ended (success, reject, timeout, cancel, error reset)
                 console.log('[Orchestrator] Session returning to IDLE state.');
                 this.resetSession(); // Clean up the session data
                 break;
             case OrchestratorState.ERROR:
                 console.error('[Orchestrator] FSM entered ERROR state. Session halted.');
                 // Optionally attempt to close MCP connection cleanly
                 // this.mcpClient.disconnect(); 
                 break;
             // Other states like REVIEW, WAIT_CONFIRM typically wait for external triggers (API calls)
             // or internal triggers (parsing complete, MCP responses)
        }
        // TODO: Notify UI about state changes via WebSocket
    }

    // Method to start a new session by parsing an instruction
    public async startSession(instruction: string): Promise<{ steps: McpToolCall[], initialState: OrchestratorState }> {
        if (this.session && this.session.fsm.getCurrentState() !== OrchestratorState.IDLE) {
            console.warn('[Orchestrator] Overwriting existing active session.');
             // Optionally reject or explicitly handle existing session cleanup
             this.resetSession();
        }

        console.log(`[Orchestrator] Starting new session with instruction: "${instruction}"`);
        const fsm = new OrchestratorFsm(this.onStateUpdate.bind(this)); // Pass bound state update handler
        this.session = { fsm, steps: [], instruction }; 

        // Ensure MCP session & SSE established upfront for new session
        await this.initializeMcpSession();
        await this.createSseClient();

        this.session.fsm.dispatch(OrchestratorEvent.RECEIVE_INSTRUCTION);
        // TODO: Notify UI

        try {
            const parsedSteps = await parseInstruction(instruction);

            // Check if session was reset during parsing (e.g., by MCP socket error)
            if (!this.session) {
                console.warn('[Orchestrator] Session was reset during parsing. Aborting startSession.');
                // Optionally throw an error or return a specific indicator
                throw new Error('Session reset during parsing'); 
            }

            if (parsedSteps && parsedSteps.length > 0) {
                this.session.steps = parsedSteps;
                 console.log(`[Orchestrator] Parsing complete, ${parsedSteps.length} steps found.`);
                this.session.fsm.dispatch(OrchestratorEvent.PARSING_COMPLETE, { steps: parsedSteps });
                // TODO: Notify UI (though steps are returned directly for now)
                return { steps: parsedSteps, initialState: this.session.fsm.getCurrentState() };
            } else {
                console.warn('[Orchestrator] Parsing failed or returned no steps.');
                this.session.fsm.dispatch(OrchestratorEvent.PARSING_FAILED);
                // TODO: Notify UI
                this.resetSession(OrchestratorState.ERROR);
                throw new Error('Parsing failed to produce steps.');
            }
        } catch (error) {
            console.error('[Orchestrator] Error during parsing instruction:', error);
            this.session?.fsm.dispatch(OrchestratorEvent.PARSING_FAILED);
            this.resetSession(OrchestratorState.ERROR);
            throw error; // Re-throw
        }
    }

    // Method called when UI confirms a step
    public confirmStep(stepIdToConfirm: string): void {
        if (!this.session || this.session.fsm.getCurrentState() !== OrchestratorState.WAIT_CONFIRM) {
            console.warn('[Orchestrator] Received confirmStep request in invalid state or no session.');
            return;
        }

        const currentStep = this.session.steps[this.session.fsm.getContext().currentStepIndex];

        if (!currentStep || currentStep.tool_call_id !== stepIdToConfirm) {
             console.warn(`[Orchestrator] Confirm request for step ID ${stepIdToConfirm} does not match current step ID ${currentStep?.tool_call_id}.`);
            // Decide how to handle mismatch - ignore? error?
            return; 
        }
        
        console.log(`[Orchestrator] Dispatching CONFIRM_STEP for step ${this.session.fsm.getContext().currentStepIndex} (ID: ${stepIdToConfirm})`);
        this.session.fsm.dispatch(OrchestratorEvent.CONFIRM_STEP);
        // Handle the state change immediately after dispatch if needed, or rely on onStateUpdate
         this.handleStateChange(this.session.fsm.getCurrentState(), this.session.fsm.getContext());
    }

    // Method called when UI rejects/cancels
    public rejectSteps(): void {
        if (!this.session || this.session.fsm.getCurrentState() !== OrchestratorState.WAIT_CONFIRM) {
             console.warn('[Orchestrator] Received rejectSteps request in invalid state or no session.');
            // Allow rejection from other states maybe? Or only WAIT_CONFIRM?
             // If allowing from anywhere, use CANCEL_SESSION event?
            return;
        }
        console.log('[Orchestrator] Dispatching REJECT_STEP.');
        this.session.fsm.dispatch(OrchestratorEvent.REJECT_STEP);
         this.handleStateChange(this.session.fsm.getCurrentState(), this.session.fsm.getContext());
    }
    
    // Method to handle manual stop/cancel from UI
    public cancelSession(): void {
        if (!this.session) {
            console.log('[Orchestrator] Received cancelSession request but no active session.');
            return;
        }
         console.log('[Orchestrator] Dispatching CANCEL_SESSION.');
         this.session.fsm.dispatch(OrchestratorEvent.CANCEL_SESSION);
         this.handleStateChange(this.session.fsm.getCurrentState(), this.session.fsm.getContext());
    }

    // Executes the step via MCP Socket
    // Update to make async and use HTTP POST
    private async executeStep(stepIndex: number): Promise<void> { 
        // Ensure we have active session and SSE client (set up in startSession)
        if (!this.sessionId || !this.mcpClient) {
            console.error('[Orchestrator] Cannot execute step: missing active MCP session.');
            if (this.session) {
                this.session.fsm.dispatch(OrchestratorEvent.STEP_FAILED, { error: { code: -32004, message: 'MCP session not initialized' } });
            }
            return;
        }

        const currentSessionId = this.sessionId;
        if (!this.session || stepIndex < 0 || stepIndex >= this.session.steps.length) {
            console.error(`[Orchestrator] Invalid stepIndex ${stepIndex} for execution.`);
            // Ensure session exists before dispatching
            if(this.session) { 
                this.session.fsm.dispatch(OrchestratorEvent.STEP_FAILED); 
            }
            return;
        }

        const stepToExecute = this.session.steps[stepIndex];
        // Translate tool name if mapping exists
        const mcpToolName = TOOL_NAME_MAP[stepToExecute.tool_name] ?? stepToExecute.tool_name;
        const currentCallId = this.rpcIdCounter++;
        console.log(`[Orchestrator] Executing Step ${stepIndex + 1}/${this.session.steps.length} (Ref ID: ${currentCallId}):`, stepToExecute);

        /* // Standard MCP Format - commented out
        const callMessage: McpMessage = {
            type: 'call',
            id: currentCallId, 
            method: stepToExecute.tool_name,
            params: stepToExecute.arguments,
        };
        */

        // --- Format as JSON-RPC 2.0 Request --- 
        const jsonRpcPayload = {
            jsonrpc: "2.0",
            id: currentCallId,
            method: "tools/call",
            params: {
                name: mcpToolName,
                arguments: stepToExecute.arguments
            }
        };

        /* // Alternative {action: ...} format - commented out 
        const altPayload = {
            action: stepToExecute.tool_name, 
            ...stepToExecute.arguments 
        };
        const commandUrl = this.mcpServerBaseUrl.endsWith('/') 
                         ? `${this.mcpServerBaseUrl}command` 
                         : `${this.mcpServerBaseUrl}/command`;
        */

        // Construct command URL with session ID
        const commandUrl = this.sseUrl ?? `${this.mcpServerBaseUrl}/sse?sessionId=${currentSessionId}`;

        // Log the message being sent
        console.log(`[Orchestrator] Sending JSON-RPC call via POST to ${commandUrl}:`, JSON.stringify(jsonRpcPayload, null, 2));
        
        // --- Send via HTTP POST --- 
        try {
            // Post to the /command URL with the JSON-RPC payload
            const response = await axios.post<any>( 
                commandUrl, // Use command URL with session ID
                jsonRpcPayload,
                { 
                    headers: { 'Content-Type': 'application/json' },
                    timeout: 30000 
                });

            const responseData = response.data;
            console.log(`[Orchestrator] Received HTTP response for Call ID ${currentCallId}:`, responseData);

            // Check if session still exists 
            if (!this.session) { 
                console.warn(`[Orchestrator] Session ended while awaiting response for Call ID ${currentCallId}. Ignoring response.`);
                return;
            }
            
            // If server returns 202 or plain "Accepted", treat as acknowledgement and wait for SSE result
            if (response.status === 202 || (typeof responseData === 'string' && responseData.toLowerCase().includes('accepted'))) {
                console.log(`[Orchestrator] Call ID ${currentCallId} acknowledged by MCP server, awaiting RESULT over SSE.`);
                // Do not change FSM state here; success/failure handled when RESULT/ERROR message arrives via SSE
            } else if (responseData && typeof responseData === 'object' && responseData.id === currentCallId) {
                if ('result' in responseData) {
                    console.log(`[Orchestrator] Step ${stepIndex + 1} completed synchronously.`);
                    const isLastStep = this.session.fsm.getContext().currentStepIndex >= this.session.fsm.getContext().totalSteps - 1;
                    const successEvent = isLastStep ? OrchestratorEvent.STEP_SUCCESS_LAST : OrchestratorEvent.STEP_SUCCESS_NEXT;
                    this.session.fsm.dispatch(successEvent, { result: responseData.result });
                } else if ('error' in responseData) {
                    console.error(`[Orchestrator] Step ${stepIndex + 1} failed synchronously. JSON-RPC Error:`, responseData.error);
                    this.session.fsm.dispatch(OrchestratorEvent.STEP_FAILED, { error: responseData.error });
                } else {
                    console.error(`[Orchestrator] Unexpected JSON-RPC response structure for Call ID ${currentCallId}:`, responseData);
                    this.session.fsm.dispatch(OrchestratorEvent.STEP_FAILED, { error: { code: -32001, message: 'Unexpected JSON-RPC response structure' } });
                }
            } else {
                console.error(`[Orchestrator] Invalid or mismatched response for Call ID ${currentCallId}:`, responseData);
                // Do not treat as fatal; wait for SSE result.
            }
            

        } catch (error: any) {
            console.error(`[Orchestrator] HTTP Error executing Step ${stepIndex + 1} (Call ID: ${currentCallId}) via ${commandUrl}:`, error.message);
             // Check if session still exists
            if (!this.session) { 
                console.warn(`[Orchestrator] Session ended before HTTP error could be processed for Call ID ${currentCallId}.`);
                return;
            }
            // Map axios error or other errors to an FSM event
            let mcpErrorCode = -32000; // Default server error
            let mcpErrorMessage = 'HTTP request failed';
            if (axios.isAxiosError(error)) {
                mcpErrorMessage = error.response?.data?.error?.message || error.message;
                mcpErrorCode = error.response?.data?.error?.code || (error.code === 'ECONNABORTED' ? -32003 : -32000); // Map timeout
            } else if (error instanceof Error) {
                mcpErrorMessage = error.message;
            }
            // Dispatch failure with error payload
            this.session.fsm.dispatch(OrchestratorEvent.STEP_FAILED, { error: { code: mcpErrorCode, message: mcpErrorMessage } });
        }
    }

    // Resets the session state
    private resetSession(finalState: OrchestratorState = OrchestratorState.IDLE): void {
        console.log(`[Orchestrator] Resetting session. Final state: ${finalState}`);
         if (this.session) {
             // Clear timers managed by FSM if necessary (depends on FSM implementation)
             this.session.fsm.clearConfirmationTimer?.(); // Add this method to FSM if needed
         }
        this.session = null;
        if (this.mcpClient) {
            this.mcpClient.disconnect();
            this.mcpClient = null;
        }
        this.sessionId = null;
        this.sseUrl = null;
        // TODO: Notify UI that session ended/reset
    }

    // Public method to get current state (e.g., for status endpoint)
    public getStatus(): { state: OrchestratorState | string; currentStep: number; totalSteps: number } {
        if (!this.session) {
            return { state: OrchestratorState.IDLE, currentStep: 0, totalSteps: 0 };
        }
        const context = this.session.fsm.getContext();
        return {
            state: this.session.fsm.getCurrentState(),
            currentStep: context.currentStepIndex,
            totalSteps: context.totalSteps,
        };
    }
} 