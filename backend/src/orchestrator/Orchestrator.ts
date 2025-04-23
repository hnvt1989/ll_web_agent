import { OrchestratorFsm, OrchestratorState, OrchestratorEvent, FsmContext } from './fsm';
import { McpSseClient } from '../mcp/socket';
import { McpMessage, Result, Error as McpError } from '../types/mcp';
import { parseInstruction } from '../parser/parseInstruction';
// Import the function to translate MCP messages to FSM events
import { translateMcpMessageToEvent } from './events'; 
import axios from 'axios';

// Define the structure for an MCP tool call (align with parser)
interface McpToolCall {
    tool_name: string;
    arguments: { [key: string]: any };
    tool_call_id?: string;
}

// Define the structure for session data managed by the orchestrator
interface SessionData {
    fsm: OrchestratorFsm;
    steps: McpToolCall[];
    instruction: string | null;
}

export class Orchestrator {
    private mcpClient: McpSseClient;
    private session: SessionData | null = null;
    private mcpServerBaseUrl: string;

    constructor(mcpServerBaseUrl: string) {
        this.mcpServerBaseUrl = mcpServerBaseUrl;
        this.mcpClient = this.initializeMcpClient();
        // No initial session
    }

    private initializeMcpClient(): McpSseClient {
        let sseUrl = this.mcpServerBaseUrl;
        if (!sseUrl.endsWith('/')) {
            sseUrl += '/';
        }
        sseUrl += 'sse'; 
        
        console.log(`[Orchestrator] Initializing SSE client for URL: ${sseUrl}`);
        const client = new McpSseClient(sseUrl);

        client.on('open', () => {
            console.log('[Orchestrator] MCP SSE Client Connected.');
            // Handle connection logic if needed (e.g., maybe reset state if disconnected mid-session)
        });

        client.on('message', (message: McpMessage) => {
            console.log('[Orchestrator] Received MCP message via SSE:', JSON.stringify(message));
            // Note: Direct results/errors from calls made via executeStep (POST) are handled there.
            // This handler should now primarily process asynchronous events initiated by the MCP server itself (if any).
            if (this.session) {
                // Translate message to FSM event
                const event = translateMcpMessageToEvent(message, this.session.fsm.getContext());
                if (event) {
                    console.log(`[Orchestrator] Dispatching FSM event from MCP message: ${event}`);
                    this.session.fsm.dispatch(event);
                    this.handleStateChange(this.session.fsm.getCurrentState(), this.session.fsm.getContext());
                } else {
                    console.log('[Orchestrator] MCP message did not translate to a relevant FSM event.');
                }
            } else {
                console.log('[Orchestrator] Received MCP message but no active session.');
            }
        });

        client.on('close', (event: Event) => {
            console.log(`[Orchestrator] MCP SSE Client Closed. Event:`, event);
            // Handle disconnection - maybe transition FSM to ERROR or IDLE if session active?
            if (this.session && this.session.fsm.getCurrentState() !== OrchestratorState.IDLE) {
                 console.warn('[Orchestrator] MCP SSE client disconnected during active session. Resetting to IDLE.');
                 // Force state to IDLE - needs careful consideration of side effects
                 this.resetSession(OrchestratorState.IDLE); 
            }
        });

        client.on('error', (error: Event) => {
            console.error('[Orchestrator] MCP SSE Client Error:', error);
            // Error handling, potentially dispatch ERROR to FSM or reset
            if (this.session && this.session.fsm.getCurrentState() !== OrchestratorState.IDLE) {
                 console.warn('[Orchestrator] MCP SSE client error during active session. Resetting to IDLE.');
                 this.resetSession(OrchestratorState.ERROR); // Go to error state
            }
        });

        // Attempt initial connection
        client.connect();
        return client;
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
        if (!this.session || stepIndex < 0 || stepIndex >= this.session.steps.length) {
            console.error(`[Orchestrator] Invalid stepIndex ${stepIndex} for execution.`);
            // Ensure session exists before dispatching
            if(this.session) { 
                this.session.fsm.dispatch(OrchestratorEvent.STEP_FAILED); 
                this.handleStateChange(this.session.fsm.getCurrentState(), this.session.fsm.getContext());
            }
            return;
        }

        const stepToExecute = this.session.steps[stepIndex];
        const currentCallId = Date.now(); // Generate unique ID for this call
        console.log(`[Orchestrator] Executing Step ${stepIndex + 1}/${this.session.steps.length} (Call ID: ${currentCallId}):`, stepToExecute);

        // Format as an MCP 'call' message
        const callMessage: McpMessage = {
            type: 'call',
            id: currentCallId, 
            method: stepToExecute.tool_name,
            params: stepToExecute.arguments,
        };

        // Log the message being sent
        console.log(`[Orchestrator] Sending MCP call via POST:`, JSON.stringify(callMessage, null, 2));

        // Remove the SSE client send call
        // this.mcpClient.send(callMessage);
        
        // --- Send via HTTP POST --- 
        try {
            // Use the base URL stored during construction. MCP calls are sent to the base endpoint.
            const response = await axios.post<Result | McpError>(this.mcpServerBaseUrl, callMessage, {
                headers: { 'Content-Type': 'application/json' },
                timeout: 30000 // Example: 30 second timeout
            });

            const responseData = response.data;
            console.log(`[Orchestrator] Received HTTP response for Call ID ${currentCallId}:`, responseData);

            // Check if session still exists (could have been cancelled while waiting)
            if (!this.session) { 
                console.warn(`[Orchestrator] Session ended while awaiting response for Call ID ${currentCallId}. Ignoring response.`);
                return;
            }
            
            // Validate response structure and ID
            if (responseData && typeof responseData === 'object' && responseData.id === currentCallId) {
                if (responseData.type === 'result') {
                    console.log(`[Orchestrator] Step ${stepIndex + 1} completed successfully.`);
                    // Check if it was the last step
                    const isLastStep = this.session.fsm.getContext().currentStepIndex >= this.session.fsm.getContext().totalSteps - 1;
                    const successEvent = isLastStep ? OrchestratorEvent.STEP_SUCCESS_LAST : OrchestratorEvent.STEP_SUCCESS_NEXT;
                    // Dispatch correct event with result payload
                    this.session.fsm.dispatch(successEvent, { result: responseData.result });
                } else if (responseData.type === 'error') {
                    console.error(`[Orchestrator] Step ${stepIndex + 1} failed. MCP Error:`, responseData.error);
                    // Dispatch failure with error payload
                    this.session.fsm.dispatch(OrchestratorEvent.STEP_FAILED, { error: responseData.error });
                } else {
                     console.error(`[Orchestrator] Received unexpected response structure for Call ID ${currentCallId}:`, responseData);
                     // Dispatch failure with error payload
                     this.session.fsm.dispatch(OrchestratorEvent.STEP_FAILED, { error: { code: -32001, message: 'Unexpected response structure' } });
                }
            } else {
                 console.error(`[Orchestrator] Received invalid or mismatched response for Call ID ${currentCallId}:`, responseData);
                 // Dispatch failure with error payload
                 this.session.fsm.dispatch(OrchestratorEvent.STEP_FAILED, { error: { code: -32002, message: 'Invalid or mismatched response ID' } });
            }

        } catch (error: any) {
            console.error(`[Orchestrator] HTTP Error executing Step ${stepIndex + 1} (Call ID: ${currentCallId}):`, error.message);
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
        
        // Handle state change triggered by the dispatch above
        if (this.session) {
            this.handleStateChange(this.session.fsm.getCurrentState(), this.session.fsm.getContext());
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