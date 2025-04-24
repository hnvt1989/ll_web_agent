// backend/src/orchestrator/fsm.ts

/**
 * Defines the possible states of the orchestration process.
 */
export enum OrchestratorState {
    IDLE = 'IDLE',                 // Waiting for a new instruction.
    REVIEW = 'REVIEW',             // Instruction received, parsing in progress or steps generated, waiting for review initiation.
    WAIT_CONFIRM = 'WAIT_CONFIRM', // Parsed steps shown to the user, waiting for confirmation of the current step.
    EXECUTE = 'EXECUTE',           // User confirmed step, execution in progress.
    ERROR = 'ERROR',               // An unrecoverable error occurred.
}

/**
 * Defines the possible events that can trigger state transitions.
 */
export enum OrchestratorEvent {
    RECEIVE_INSTRUCTION = 'RECEIVE_INSTRUCTION', // A new natural language instruction is submitted.
    PARSING_COMPLETE = 'PARSING_COMPLETE',       // Instruction successfully parsed into steps.
    PARSING_FAILED = 'PARSING_FAILED',           // Instruction parsing failed critically.
    CONFIRM_STEP = 'CONFIRM_STEP',               // User confirmed the current step for execution.
    REJECT_STEP = 'REJECT_STEP',                 // User rejected the current step.
    STEP_SUCCESS_NEXT = 'STEP_SUCCESS_NEXT',     // Current step executed successfully, more steps remain.
    STEP_SUCCESS_LAST = 'STEP_SUCCESS_LAST',     // The last step executed successfully.
    STEP_FAILED = 'STEP_FAILED',                 // Step execution failed after retries.
    CONFIRM_TIMEOUT = 'CONFIRM_TIMEOUT',         // Timeout waiting for user confirmation.
    CANCEL_SESSION = 'CANCEL_SESSION',           // User manually stopped the session or UI closed.
    RESET = 'RESET',                             // Event to reset the machine from an ERROR state.
}

// Define context associated with the FSM
export interface FsmContext {
    retryCount: number;
    currentStepIndex: number; // To know when to reset retry count
    totalSteps: number; // To distinguish STEP_SUCCESS_NEXT from STEP_SUCCESS_LAST
    // timerId?: NodeJS.Timeout | number; // Optional: For managing the timer externally or internally
}

// Configuration constants
export const MAX_RETRIES = 0;
export const CONFIRMATION_TIMEOUT_MS = 120000; // 120 seconds

/**
 * Represents the FSM with its state and context.
 */
export class OrchestratorFsm {
    private currentState: OrchestratorState;
    private context: FsmContext;
    private confirmationTimerId: NodeJS.Timeout | null = null;

    constructor(private readonly onStateUpdate?: (newState: OrchestratorState, context: FsmContext) => void) {
        this.currentState = OrchestratorState.IDLE;
        this.context = this.resetContext();
        this.notifyStateUpdate();
    }

    private resetContext(): FsmContext {
        return {
            retryCount: 0,
            currentStepIndex: -1, // Start before the first step
            totalSteps: 0,
        };
    }

    private notifyStateUpdate() {
        if (this.onStateUpdate) {
            // Provide a copy to prevent external mutation
            this.onStateUpdate(this.currentState, { ...this.context });
        }
        console.log(`State: ${this.currentState}, Context: ${JSON.stringify(this.context)}`);
    }

     private startConfirmationTimer(timeoutCallback: () => void) {
        this.clearConfirmationTimer(); // Clear existing timer first
        console.log(`Starting confirmation timer (${CONFIRMATION_TIMEOUT_MS}ms)`);
        this.confirmationTimerId = setTimeout(() => {
            console.log('Confirmation timer expired.');
            this.confirmationTimerId = null; // Clear the ID
            timeoutCallback(); // Execute the timeout logic (usually dispatching CONFIRM_TIMEOUT)
        }, CONFIRMATION_TIMEOUT_MS);
     }

    public clearConfirmationTimer() {
        if (this.confirmationTimerId) {
            console.log('Clearing confirmation timer.');
            clearTimeout(this.confirmationTimerId);
            this.confirmationTimerId = null;
        }
    }


    /**
     * Processes an event and transitions the FSM to a new state.
     * Manages context like retry counts and timers.
     *
     * @param event The event to process.
     * @param payload Optional data associated with the event (e.g., parsed steps, result, error).
     */
    public dispatch(event: OrchestratorEvent, payload?: { steps?: any[]; result?: any; error?: any }): void {
        const previousState = this.currentState;
        console.log(`Dispatching Event: ${event}, Current State: ${this.currentState}, Payload:`, payload);

        // --- State Transition Logic ---
        switch (this.currentState) {
            case OrchestratorState.IDLE:
                if (event === OrchestratorEvent.RECEIVE_INSTRUCTION) {
                    this.currentState = OrchestratorState.REVIEW;
                    this.context = this.resetContext(); // Reset context for new instruction
                }
                break;

            case OrchestratorState.REVIEW:
                if (event === OrchestratorEvent.PARSING_COMPLETE && payload?.steps) {
                    this.currentState = OrchestratorState.WAIT_CONFIRM;
                    this.context.totalSteps = payload.steps.length;
                    this.context.currentStepIndex = 0; // Ready for the first step
                    // Start timer when entering WAIT_CONFIRM
                    this.startConfirmationTimer(() => this.dispatch(OrchestratorEvent.CONFIRM_TIMEOUT));
                } else if (event === OrchestratorEvent.PARSING_FAILED) {
                    this.currentState = OrchestratorState.ERROR;
                } else if (event === OrchestratorEvent.CANCEL_SESSION) {
                    this.currentState = OrchestratorState.IDLE;
                }
                break;

            case OrchestratorState.WAIT_CONFIRM:
                 // Clear timer on any event leaving this state
                 this.clearConfirmationTimer();

                if (event === OrchestratorEvent.CONFIRM_STEP) {
                    this.currentState = OrchestratorState.EXECUTE;
                    this.context.retryCount = 0; // Reset retries for the new step
                } else if (event === OrchestratorEvent.REJECT_STEP ||
                           event === OrchestratorEvent.CANCEL_SESSION ||
                           event === OrchestratorEvent.CONFIRM_TIMEOUT) {
                    this.currentState = OrchestratorState.IDLE;
                } else {
                     // If staying in WAIT_CONFIRM (e.g., irrelevant event), restart timer
                     this.startConfirmationTimer(() => this.dispatch(OrchestratorEvent.CONFIRM_TIMEOUT));
                }
                break;

            case OrchestratorState.EXECUTE:
                 if (event === OrchestratorEvent.STEP_SUCCESS_NEXT) {
                     // Check if it was the actual last step based on context
                    if (this.context.currentStepIndex >= this.context.totalSteps - 1) {
                         console.warn("Received STEP_SUCCESS_NEXT but context indicates it was the last step. Treating as STEP_SUCCESS_LAST.");
                         this.currentState = OrchestratorState.IDLE;
                    } else {
                         this.currentState = OrchestratorState.WAIT_CONFIRM;
                         this.context.currentStepIndex++; // Move to next step
                         // Start timer for the next confirmation
                         this.startConfirmationTimer(() => this.dispatch(OrchestratorEvent.CONFIRM_TIMEOUT));
                    }
                 } else if (event === OrchestratorEvent.STEP_SUCCESS_LAST) {
                     this.currentState = OrchestratorState.IDLE; // Finished successfully
                 } else if (event === OrchestratorEvent.STEP_FAILED) {
                    if (this.context.retryCount < MAX_RETRIES) {
                        this.context.retryCount++;
                        // Stay in EXECUTE state, caller should handle the retry attempt.
                        console.log(`Step failed. Retry count: ${this.context.retryCount}/${MAX_RETRIES}. Staying in EXECUTE.`);
                        // Note: FSM doesn't trigger the retry, just tracks count. Caller handles retry logic.
                    } else {
                        console.log(`Step failed after ${MAX_RETRIES} retries. Transitioning to ERROR.`);
                        this.currentState = OrchestratorState.ERROR;
                    }
                } else if (event === OrchestratorEvent.CANCEL_SESSION) {
                    this.currentState = OrchestratorState.IDLE;
                }
                break;

            case OrchestratorState.ERROR:
                if (event === OrchestratorEvent.RESET || event === OrchestratorEvent.CANCEL_SESSION) {
                    this.currentState = OrchestratorState.IDLE;
                    this.context = this.resetContext();
                }
                break;
        }

        // Notify if state changed
        if (this.currentState !== previousState) {
             // Ensure timer is cleared if we are leaving WAIT_CONFIRM state due to the transition logic above
            if (previousState === OrchestratorState.WAIT_CONFIRM && this.currentState !== OrchestratorState.WAIT_CONFIRM) {
                 this.clearConfirmationTimer();
            }
            this.notifyStateUpdate();
        } else {
             console.log(`No state change for event ${event} in state ${previousState}`);
        }
    }

    public getCurrentState(): OrchestratorState {
        return this.currentState;
    }

     public getContext(): Readonly<FsmContext> {
        return { ...this.context }; // Return a copy
    }
}


// --- Pure transition function (optional, kept for reference/simpler testing if needed) ---
/**
 * Represents the FSM transition logic (stateless version).
 * Given the current state, context and an event, it returns the next state.
 * NOTE: This pure version doesn't handle timers or context updates directly.
 * The class-based approach above is preferred for managing side effects.
 *
 * @param currentState The current state of the orchestrator.
 * @param event The event that occurred.
 * @param context The current context (e.g., retry count).
 * @returns The new state after the transition.
 */
 export function transitionPure(
    currentState: OrchestratorState,
    event: OrchestratorEvent,
    context: FsmContext // Now requires context
): OrchestratorState {
     switch (currentState) {
         case OrchestratorState.IDLE:
            return (event === OrchestratorEvent.RECEIVE_INSTRUCTION) ? OrchestratorState.REVIEW : currentState;

        case OrchestratorState.REVIEW:
            if (event === OrchestratorEvent.PARSING_COMPLETE) return OrchestratorState.WAIT_CONFIRM;
            if (event === OrchestratorEvent.PARSING_FAILED) return OrchestratorState.ERROR;
            if (event === OrchestratorEvent.CANCEL_SESSION) return OrchestratorState.IDLE;
            return currentState;

        case OrchestratorState.WAIT_CONFIRM:
             if (event === OrchestratorEvent.CONFIRM_STEP) return OrchestratorState.EXECUTE;
             if (event === OrchestratorEvent.REJECT_STEP ||
                 event === OrchestratorEvent.CANCEL_SESSION ||
                 event === OrchestratorEvent.CONFIRM_TIMEOUT) return OrchestratorState.IDLE;
             return currentState;

        case OrchestratorState.EXECUTE:
             if (event === OrchestratorEvent.STEP_SUCCESS_NEXT && context.currentStepIndex < context.totalSteps - 1) return OrchestratorState.WAIT_CONFIRM;
             if (event === OrchestratorEvent.STEP_SUCCESS_LAST || (event === OrchestratorEvent.STEP_SUCCESS_NEXT && context.currentStepIndex >= context.totalSteps - 1)) return OrchestratorState.IDLE;
             if (event === OrchestratorEvent.STEP_FAILED) {
                 // Check retry count from context
                 return (context.retryCount < MAX_RETRIES) ? currentState : OrchestratorState.ERROR; // Stay in EXECUTE if retries left, else ERROR
             }
             if (event === OrchestratorEvent.CANCEL_SESSION) return OrchestratorState.IDLE;
             return currentState;

        case OrchestratorState.ERROR:
            return (event === OrchestratorEvent.RESET || event === OrchestratorEvent.CANCEL_SESSION) ? OrchestratorState.IDLE : currentState;

        default:
            console.error(`Unhandled state in transitionPure: ${currentState}`);
            return currentState;
    }
}

// Example of how a class might manage state (optional structure)
/*
export class OrchestratorFsm {
    private currentState: OrchestratorState;

    constructor() {
        this.currentState = OrchestratorState.IDLE;
    }

    public dispatch(event: OrchestratorEvent): OrchestratorState {
        const nextState = transition(this.currentState, event);
        console.log(`State Change: ${this.currentState} -> ${nextState} on ${event}`);
        this.currentState = nextState;
        return this.currentState;
    }

    public getCurrentState(): OrchestratorState {
        return this.currentState;
    }
}

// Usage:
const fsm = new OrchestratorFsm();
console.log("Initial State:", fsm.getCurrentState());
fsm.dispatch(OrchestratorEvent.RECEIVE_INSTRUCTION);
// ... dispatch other events based on system interactions
*/ 