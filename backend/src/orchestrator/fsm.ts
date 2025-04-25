// backend/src/orchestrator/fsm.ts

// import logger from '../utils/logger';
import { McpToolCall } from './Orchestrator'; // Import McpToolCall type if defined in Orchestrator

/**
 * Defines the possible states of the orchestration process.
 */
export enum OrchestratorState {
    IDLE = 'IDLE',                 // Waiting for a new instruction.
    WAIT_CONFIRM = 'WAIT_CONFIRM', // Step (initial or refined) ready, waiting for user confirmation.
    EXECUTE = 'EXECUTE',           // User confirmed step, triggering execution via Orchestrator.
    WAIT_MCP_RESPONSE = 'WAIT_MCP_RESPONSE', // Step sent to MCP, waiting for snapshot/result via SSE.
    WAIT_LLM_RESPONSE = 'WAIT_LLM_RESPONSE', // Waiting for LLM to refine the next step based on snapshot.
    ERROR = 'ERROR',               // An unrecoverable error occurred.
}

/**
 * Defines the possible events that can trigger state transitions.
 */
export enum OrchestratorEvent {
    PARSING_COMPLETE = 'PARSING_COMPLETE',       // Instruction successfully parsed into steps.
    PARSING_FAILED = 'PARSING_FAILED',           // Instruction parsing failed critically.
    CONFIRM_STEP = 'CONFIRM_STEP',               // User confirmed the current step for execution.
    REJECT_STEP = 'REJECT_STEP',                 // User rejected the current step/session.
    MCP_RESPONSE_RECEIVED = 'MCP_RESPONSE_RECEIVED', // Snapshot/result/error received from MCP after execution.
    LLM_RESPONSE_RECEIVED = 'LLM_RESPONSE_RECEIVED', // LLM successfully refined the next step.
    LLM_RESPONSE_FAILED = 'LLM_RESPONSE_FAILED',   // LLM failed to refine the step.
    STEP_FAILED = 'STEP_FAILED',                 // Step execution failed (reported by MCP or Orchestrator).
    CANCEL_SESSION = 'CANCEL_SESSION',           // User manually stopped the session or UI closed.
    RESET = 'RESET',                             // Event to reset the machine from an ERROR state.
}

// Define context associated with the FSM
export interface FsmContext {
    retryCount: number; // Retries for a single step execution/refinement
    currentStepIndex: number; // Index of the step *being prepared or executed*
    totalSteps: number;
    steps: McpToolCall[]; // Stores the potentially refined steps
    latestSnapshot: string | null; // Stores the most recent snapshot from MCP
    stepToConfirm: McpToolCall | null; // Stores the step (original or refined) waiting for confirmation
    lastError: any | null; // Store last error details
}

// Configuration constants
export const MAX_RETRIES = 0; // Max retries *per step*

/**
 * Represents the FSM with its state and context.
 */
export class OrchestratorFsm {
    private currentState: OrchestratorState;
    private context: FsmContext;

    constructor(private readonly onStateUpdate?: (newState: OrchestratorState, context: FsmContext) => void) {
        this.currentState = OrchestratorState.IDLE;
        this.context = this.resetContext();
        // logger.info('[FSM] Initialized.');
        console.log('[FSM] Initialized.');
        this.notifyStateUpdate();
    }

    private resetContext(): FsmContext {
        return {
            retryCount: 0,
            currentStepIndex: -1,
            totalSteps: 0,
            steps: [],
            latestSnapshot: null,
            stepToConfirm: null,
            lastError: null,
        };
    }

    private notifyStateUpdate() {
        if (this.onStateUpdate) {
            // Provide a copy to prevent external mutation
            this.onStateUpdate(this.currentState, { ...this.context });
        }
        // Reduced logging verbosity for context unless debugging
        // logger.info(`[FSM] State: ${this.currentState}, CurrentStep: ${this.context.currentStepIndex}`); 
        console.log(`[FSM] State: ${this.currentState}, CurrentStep: ${this.context.currentStepIndex}`); 
    }

    /**
     * Processes an event and transitions the FSM to a new state.
     *
     * @param event The event to process.
     * @param payload Optional data associated with the event.
     */
    public dispatch(
        event: OrchestratorEvent,
        payload?: { steps?: McpToolCall[]; snapshot?: string; refinedStep?: McpToolCall; error?: any; reason?: string; stepId?: number | string; }
    ): void {
        const previousState = this.currentState;
        // logger.info(`[FSM Dispatch] Event: ${event}, State: ${previousState}, StepIdx: ${this.context.currentStepIndex}`);
        console.log(`[FSM Dispatch] Event: ${event}, State: ${previousState}, StepIdx: ${this.context.currentStepIndex}`);

        // --- Reset retry count when moving to a new step processing phase ---
        // This might happen on PARSING_COMPLETE or when advancing after MCP_RESPONSE_RECEIVED
        // We'll handle it explicitly within the transitions.

        // --- State Transition Logic --- 
        switch (this.currentState) {
            case OrchestratorState.IDLE:
                if (event === OrchestratorEvent.PARSING_COMPLETE && payload?.steps) {
                    // logger.info('[FSM Dispatch] Parsing complete.');
                    console.log('[FSM Dispatch] Parsing complete.');
                    this.context.steps = payload.steps;
                    this.context.totalSteps = payload.steps.length;
                    this.context.currentStepIndex = -1; // Reset index
                    this.context.latestSnapshot = null; // Reset snapshot
                    this.context.stepToConfirm = null;
                    this.context.lastError = null;
                    this.context.retryCount = 0;

                    const firstExecutableIndex = this.findNextExecutableStep(this.context.currentStepIndex);

                    if (firstExecutableIndex !== -1) {
                        // logger.info(`[FSM Dispatch] Preparing first step ${firstExecutableIndex} for confirmation.`);
                        console.log(`[FSM Dispatch] Preparing first step ${firstExecutableIndex} for confirmation.`);
                        this.context.currentStepIndex = firstExecutableIndex;
                        this.context.stepToConfirm = this.context.steps[firstExecutableIndex];
                        this.currentState = OrchestratorState.WAIT_CONFIRM;
                    } else {
                        // logger.info('[FSM Dispatch] No executable steps found after parsing. Session complete? Returning to IDLE.');
                        console.log('[FSM Dispatch] No executable steps found after parsing. Session complete? Returning to IDLE.');
                        this.currentState = OrchestratorState.IDLE;
                        this.context = this.resetContext();
                    }
                } else if (event === OrchestratorEvent.PARSING_FAILED) {
                     // logger.error({ error: payload?.error }, '[FSM Dispatch] Parsing failed. Entering ERROR state.');
                     console.error('[FSM Dispatch] Parsing failed. Entering ERROR state.', { error: payload?.error });
                     this.context.lastError = payload?.error || 'Parsing failed';
                     this.currentState = OrchestratorState.ERROR;
                }
                break;

            case OrchestratorState.WAIT_CONFIRM:
                if (event === OrchestratorEvent.CONFIRM_STEP) {
                    if (this.context.stepToConfirm && this.context.currentStepIndex !== -1) {
                        // logger.info(`[FSM Dispatch] User confirmed step ${this.context.currentStepIndex}. Entering EXECUTE.`);
                        console.log(`[FSM Dispatch] User confirmed step ${this.context.currentStepIndex}. Entering EXECUTE.`);
                        this.context.stepToConfirm = null; // Clear the step to confirm
                        this.context.retryCount = 0; // Reset retries for this execution attempt
                        this.currentState = OrchestratorState.EXECUTE;
                    } else {
                         // logger.error('[FSM Dispatch] Invalid state for CONFIRM_STEP: Missing stepToConfirm or invalid index.');
                         console.error('[FSM Dispatch] Invalid state for CONFIRM_STEP: Missing stepToConfirm or invalid index.');
                         this.context.lastError = 'Internal error during confirmation';
                         this.currentState = OrchestratorState.ERROR;
                    }
                } else if (event === OrchestratorEvent.REJECT_STEP || event === OrchestratorEvent.CANCEL_SESSION) {
                    // logger.info(`[FSM Dispatch] Session rejected/cancelled during WAIT_CONFIRM. Entering IDLE.`);
                    console.log(`[FSM Dispatch] Session rejected/cancelled during WAIT_CONFIRM. Entering IDLE.`);
                    this.currentState = OrchestratorState.IDLE;
                    this.context = this.resetContext();
                }
                break;

            case OrchestratorState.EXECUTE:
                if (event === OrchestratorEvent.MCP_RESPONSE_RECEIVED) {
                    // logger.info('[FSM Dispatch] MCP response received.');
                    console.log('[FSM Dispatch] MCP response received.');
                    this.context.latestSnapshot = payload?.snapshot ?? null; // Store snapshot if present

                    if (payload?.error) {
                        // logger.error({ error: payload.error }, '[FSM Dispatch] MCP reported execution error.');
                        console.error('[FSM Dispatch] MCP reported execution error.', { error: payload.error });
                        this.context.lastError = payload.error;
                        if (this.context.retryCount < MAX_RETRIES) {
                            this.context.retryCount++;
                            // logger.warn(`[FSM Dispatch] Retrying step ${this.context.currentStepIndex} (Attempt ${this.context.retryCount}). Re-entering EXECUTE.`);
                            console.warn(`[FSM Dispatch] Retrying step ${this.context.currentStepIndex} (Attempt ${this.context.retryCount}). Re-entering EXECUTE.`);
                            this.currentState = OrchestratorState.EXECUTE;
                        } else {
                            // logger.error('[FSM Dispatch] Max retries reached for MCP error. Entering ERROR state.');
                            console.error('[FSM Dispatch] Max retries reached for MCP error. Entering ERROR state.');
                            this.currentState = OrchestratorState.ERROR;
                        }
                    } else {
                        // logger.info(`[FSM Dispatch] Step ${this.context.currentStepIndex} execution successful. Processing next step.`);
                        console.log(`[FSM Dispatch] Step ${this.context.currentStepIndex} execution successful. Processing next step.`);
                        const nextExecutableIndex = this.findNextExecutableStep(this.context.currentStepIndex);

                        if (nextExecutableIndex !== -1) {
                            // logger.info(`[FSM Dispatch] Found next executable step index: ${nextExecutableIndex}`);
                            console.log(`[FSM Dispatch] Found next executable step index: ${nextExecutableIndex}`);
                            this.context.currentStepIndex = nextExecutableIndex; // Advance index
                            this.context.retryCount = 0; // Reset retries for the new step/refinement
                            const nextStep = this.context.steps[this.context.currentStepIndex];
                            
                            const needsRefinement = this.checkRefinementNeeded(nextStep);
                            const snapshotAvailable = !!this.context.latestSnapshot;

                            if (needsRefinement) {
                                if (snapshotAvailable) {
                                    // logger.info(`[FSM Dispatch] Step ${this.context.currentStepIndex} requires refinement. Entering WAIT_LLM_RESPONSE.`);
                                    console.log(`[FSM Dispatch] Step ${this.context.currentStepIndex} requires refinement. Entering WAIT_LLM_RESPONSE.`);
                                    this.currentState = OrchestratorState.WAIT_LLM_RESPONSE;
                                } else {
                                    // logger.error(`[FSM Dispatch] Step ${this.context.currentStepIndex} needs refinement, but no snapshot available. Entering ERROR.`);
                                    console.error(`[FSM Dispatch] Step ${this.context.currentStepIndex} needs refinement, but no snapshot available. Entering ERROR.`);
                                    this.context.lastError = 'Refinement required but snapshot missing';
                                    this.currentState = OrchestratorState.ERROR;
                                }
                            } else {
                                // logger.info(`[FSM Dispatch] Step ${this.context.currentStepIndex} does not need refinement. Preparing for confirmation.`);
                                console.log(`[FSM Dispatch] Step ${this.context.currentStepIndex} does not need refinement. Preparing for confirmation.`);
                                this.context.stepToConfirm = nextStep;
                                this.currentState = OrchestratorState.WAIT_CONFIRM;
                            }
                        } else {
                            // logger.info('[FSM Dispatch] No more executable steps found. Session complete. Entering IDLE.');
                            console.log('[FSM Dispatch] No more executable steps found. Session complete. Entering IDLE.');
                            this.currentState = OrchestratorState.IDLE;
                            this.context = this.resetContext();
                        }
                    }
                } else if (event === OrchestratorEvent.STEP_FAILED) {
                     // logger.error({ error: payload?.error, stepId: payload?.stepId }, '[FSM Dispatch] Orchestrator reported step failure during EXECUTE.');
                     console.error('[FSM Dispatch] Orchestrator reported step failure during EXECUTE.', { error: payload?.error, stepId: payload?.stepId });
                     this.context.lastError = payload?.error || 'Step execution failed';
                     if (this.context.retryCount < MAX_RETRIES) {
                        this.context.retryCount++;
                        // logger.warn(`[FSM Dispatch] Retrying step ${this.context.currentStepIndex} (Attempt ${this.context.retryCount}). Re-entering EXECUTE.`);
                        console.warn(`[FSM Dispatch] Retrying step ${this.context.currentStepIndex} (Attempt ${this.context.retryCount}). Re-entering EXECUTE.`);
                        this.currentState = OrchestratorState.EXECUTE;
                    } else {
                        // logger.error('[FSM Dispatch] Max retries reached for Orchestrator failure. Entering ERROR state.');
                        console.error('[FSM Dispatch] Max retries reached for Orchestrator failure. Entering ERROR state.');
                        this.currentState = OrchestratorState.ERROR;
                    }
                } else if (event === OrchestratorEvent.CANCEL_SESSION) {
                     // logger.info('[FSM Dispatch] Session cancelled during EXECUTE. Entering IDLE.');
                     console.log('[FSM Dispatch] Session cancelled during EXECUTE. Entering IDLE.');
                     this.currentState = OrchestratorState.IDLE;
                     this.context = this.resetContext();
                }
                break;
                
            case OrchestratorState.WAIT_LLM_RESPONSE:
                if (event === OrchestratorEvent.LLM_RESPONSE_RECEIVED && payload?.refinedStep) {
                    // logger.info(`[FSM Dispatch] LLM refinement successful for step ${this.context.currentStepIndex}. Preparing confirmation.`);
                    console.log(`[FSM Dispatch] LLM refinement successful for step ${this.context.currentStepIndex}. Preparing confirmation.`);
                    this.context.steps[this.context.currentStepIndex] = payload.refinedStep;
                    this.context.stepToConfirm = payload.refinedStep;
                    this.context.retryCount = 0;
                    this.currentState = OrchestratorState.WAIT_CONFIRM;
                } else if (event === OrchestratorEvent.LLM_RESPONSE_FAILED) {
                    // logger.error({ error: payload?.error }, `[FSM Dispatch] LLM refinement failed for step ${this.context.currentStepIndex}.`);
                    console.error(`[FSM Dispatch] LLM refinement failed for step ${this.context.currentStepIndex}.`, { error: payload?.error });
                    this.context.lastError = payload?.error || 'LLM refinement failed';
                     if (this.context.retryCount < MAX_RETRIES) {
                        this.context.retryCount++;
                        // logger.warn(`[FSM Dispatch] Retrying LLM refinement for step ${this.context.currentStepIndex} (Attempt ${this.context.retryCount}). Re-entering WAIT_LLM_RESPONSE.`);
                        console.warn(`[FSM Dispatch] Retrying LLM refinement for step ${this.context.currentStepIndex} (Attempt ${this.context.retryCount}). Re-entering WAIT_LLM_RESPONSE.`);
                        this.currentState = OrchestratorState.WAIT_LLM_RESPONSE;
                    } else {
                        // logger.error('[FSM Dispatch] Max retries reached for LLM refinement. Entering ERROR state.');
                        console.error('[FSM Dispatch] Max retries reached for LLM refinement. Entering ERROR state.');
                        this.currentState = OrchestratorState.ERROR;
                    }
                } else if (event === OrchestratorEvent.CANCEL_SESSION) {
                    // logger.info('[FSM Dispatch] Session cancelled while waiting for LLM. Entering IDLE.');
                    console.log('[FSM Dispatch] Session cancelled while waiting for LLM. Entering IDLE.');
                    this.currentState = OrchestratorState.IDLE;
                    this.context = this.resetContext();
                }
                break;

            case OrchestratorState.ERROR:
                if (event === OrchestratorEvent.RESET || event === OrchestratorEvent.CANCEL_SESSION) {
                    // logger.info(`[FSM Dispatch] Resetting from ERROR state due to ${event}. Entering IDLE.`);
                    console.log(`[FSM Dispatch] Resetting from ERROR state due to ${event}. Entering IDLE.`);
                    this.currentState = OrchestratorState.IDLE;
                    this.context = this.resetContext();
                }
                break;

            default:
                // logger.warn(`Unhandled state in dispatch: ${this.currentState}`);
                console.warn(`Unhandled state in dispatch: ${this.currentState}`);
        }

        // Notify Orchestrator if state changed
        if (this.currentState !== previousState) {
            // logger.info(`[FSM Dispatch] Completed state transition: ${previousState} -> ${this.currentState}`);
            console.log(`[FSM Dispatch] Completed state transition: ${previousState} -> ${this.currentState}`);
            this.notifyStateUpdate();
        } else {
             // logger.info(`[FSM Dispatch] Event ${event} did not cause state change from ${previousState}.`);
             console.log(`[FSM Dispatch] Event ${event} did not cause state change from ${previousState}.`);
        }
    }

    /**
     * Finds the index of the next step in the list that is executable (not browser_snapshot).
     * Starts searching from the index *after* the given `currentIndex`.
     * @param currentIndex The index of the last processed step. Search starts *after* this index.
     * @returns The index of the next executable step, or -1 if none found.
     */
    private findNextExecutableStep(currentIndex: number): number {
        if (!this.context.steps || this.context.steps.length === 0) {
            return -1;
        }
        for (let i = currentIndex + 1; i < this.context.steps.length; i++) {
            if (this.context.steps[i]?.tool_name !== 'browser_snapshot') {
                return i;
            }
        }
        return -1;
    }

    /**
     * Checks if a given step requires refinement (contains <UNKNOWN> arguments).
     * @param step The step to check.
     * @returns True if refinement is needed, false otherwise.
     */
    private checkRefinementNeeded(step: McpToolCall | null | undefined): boolean {
        if (!step || !step.arguments) {
            return false;
        }
        return Object.values(step.arguments).some(value => value === '<UNKNOWN>');
    }

    public getCurrentState(): OrchestratorState {
        return this.currentState;
    }

    public getContext(): Readonly<FsmContext> {
        return { ...this.context };
    }
} 