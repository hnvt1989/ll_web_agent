import React, { useState, useEffect } from 'react';
import StepReviewModal from './components/StepReviewModal'; // Import the modal
import StatusHUD from './components/StatusHUD'; // Import StatusHUD

// Define step structure (can be imported from backend types if shared)
interface McpToolCall {
    tool_call_id: string;
    tool_name: string;
    arguments: { [key: string]: any };
}

// Get the API base URL from environment variables
// Default to localhost:3000 if not set, which works for docker compose setup
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';

function App() {
  const [instruction, setInstruction] = useState('');
  const [isParsing, setIsParsing] = useState(false); // Renamed from isLoading for clarity
  const [parseError, setParseError] = useState<string | null>(null);
  const [isStopping, setIsStopping] = useState(false);
  const [stopError, setStopError] = useState<string | null>(null);

  // State for managing parsed steps and review modal
  const [steps, setSteps] = useState<McpToolCall[]>([]);
  const [isReviewModalOpen, setIsReviewModalOpen] = useState(false);
  const [currentStepIndex, setCurrentStepIndex] = useState(0); // 0-based index

  // TODO: Replace with actual state management (e.g., context, Zustand, Redux)
  // Use strings for state representation in the UI
  const [sessionState, setSessionState] = useState<string>('IDLE');

  const [buttonsDisabled, setButtonsDisabled] = useState(false);

  // Use the correct type for the timeout in a React environment
  const [disableTimeout, setDisableTimeout] = useState<ReturnType<typeof setTimeout> | null>(null);

  // --- Handlers for Modal --- 
  const handleAcceptStep = async (stepId: string) => {
    console.log(`User accepted step ID: ${stepId}`);
    // TODO: Send confirmation to backend/orchestrator
    
    // --- Send confirmation to backend --- 
    try {
      const confirmUrl = `${API_BASE_URL}/api/confirm`;
      const response = await fetch(confirmUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stepId }), // Send the accepted step ID
      });

      if (!response.ok) {
        // Try to get error details from backend response
        let errorMsg = `Confirmation failed: ${response.status} ${response.statusText}`;
        try { const errorData = await response.json(); errorMsg = errorData.message || errorMsg; } catch (e) { /* ignore */ }
        throw new Error(errorMsg);
      }
      
      // Response received (likely 202 Accepted), now update UI state
      console.log(`Confirmation for step ${stepId} sent successfully.`);

    } catch (err) {
      console.error('Error sending confirmation:', err);
      // TODO: Display this error to the user (e.g., using a state variable like parseError/stopError)
      setParseError(err instanceof Error ? err.message : 'Failed to confirm step with backend.'); // Reuse parseError state for now
      // Optionally revert UI state or stop processing further steps on error
      return; // Stop processing if confirmation failed
    }
    // --- End send confirmation --- 

    // Set a timeout to re-enable buttons after 30 seconds
    const timeout = setTimeout(() => {
      setButtonsDisabled(false); // Re-enable buttons after 30 seconds
    }, 30000); // 30 seconds
    setDisableTimeout(timeout);

    // Ensure buttons are disabled immediately after accepting a step
    setButtonsDisabled(true);

    // TODO: Move to next step or finish if last step
    const nextStepIndex = currentStepIndex + 1;
    if (nextStepIndex < steps.length) {
      setCurrentStepIndex(nextStepIndex);
      setIsReviewModalOpen(true);
      setSessionState('WAIT_CONFIRM');
      if (disableTimeout) {
        clearTimeout(disableTimeout);
        setDisableTimeout(null);
      }
    } else {
      // Last step was accepted
      setIsReviewModalOpen(false);
      setSessionState('IDLE');
      setSteps([]);
      if (disableTimeout) {
        clearTimeout(disableTimeout);
        setDisableTimeout(null);
      }
    }
  };

  const handleRejectSteps = () => {
    console.log('User rejected steps');
    // TODO: Send rejection/cancel signal to backend/orchestrator
    setIsReviewModalOpen(false);
    setSteps([]); // Clear steps
    setCurrentStepIndex(0);
    setSessionState('IDLE'); // Use string state
  };

  const handleInputChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => { // Changed input to textarea to match InstructionInput
    setInstruction(event.target.value);
    if (parseError) {
      setParseError(null); // Clear parse error when user types again
    }
     if (stopError) {
      setStopError(null); // Clear stop error when user types again
    }
  };

  const handleParseSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!instruction.trim()) return;

    setIsParsing(true);
    setParseError(null);
    setStopError(null); // Clear previous errors

    try {
      const apiUrl = `${API_BASE_URL}/api/parse`;
      console.log('[App.tsx] Fetching:', apiUrl); // <-- Log the URL
      const response = await fetch(apiUrl, { // Assuming InstructionInput is merged or this logic lives here now
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instruction }),
      });
       if (!response.ok) {
        let errorMsg = `Error: ${response.status} ${response.statusText}`;
         try { const errorData = await response.json(); errorMsg = errorData.message || errorMsg; } catch (e) { /* ignore */ }
        throw new Error(errorMsg);
      }
      const parsedData = await response.json();
      console.log('Parsing successful, raw data:', JSON.stringify(parsedData)); // <-- Log raw data

      console.log('[App.tsx] Reached point just before IF check'); // <-- ADD THIS LOG
      // --- Update UI state with parsed steps --- 
      // Temporarily simplify the check just to see if the block is entered
      if (parsedData) { 
      // if (parsedData && Array.isArray(parsedData.steps) && parsedData.steps.length > 0) { // Original check
        console.log('Condition met: Steps received (Simplified Check). Attempting to open modal...'); // <-- Log condition met
        
        // Original logic inside the IF block:
        if (parsedData && Array.isArray(parsedData.steps) && parsedData.steps.length > 0) { // Check again inside for safety
            setSteps(parsedData.steps);
            setCurrentStepIndex(0); // Start review from the first step
            setIsReviewModalOpen(true);
            console.log('Called setIsReviewModalOpen(true)'); // <-- Log state setter call
            setSessionState('WAIT_CONFIRM'); // Use string state
        } else {
             console.log('Condition NOT met within simplified block: No steps array or empty steps.'); // <-- Log if inner check fails
             setSteps([]);
             setParseError('Could not parse instruction into actionable steps.');
             setSessionState('IDLE'); // Use string state
        }
      } else {
        console.log('Condition NOT met: parsedData is falsy.'); // <-- Log condition not met
        // Handle case where backend returns 200 OK but no steps
        console.log('Parsing returned no steps.');
        setSteps([]);
        setParseError('Could not parse instruction into actionable steps.');
        setSessionState('IDLE'); // Use string state
      }
      // setInstruction(''); // Optionally clear
    } catch (err) {
      console.error('Parsing failed:', err);
      const errorToShow = err instanceof Error ? err.message : 'An unknown error occurred during parsing.';
      setParseError(errorToShow);
    } finally {
      setIsParsing(false);
    }
  };


  const handleStopSession = async () => {
      setIsStopping(true);
      setStopError(null);
      setParseError(null); // Clear other errors

      try {
          const stopUrl = `${API_BASE_URL}/api/stop`;
          console.log('[App.tsx] Fetching:', stopUrl); // <-- Log the URL
          const response = await fetch(stopUrl, {
              method: 'POST', // Or 'GET' if the backend expects that
              headers: {
                  'Content-Type': 'application/json', // Optional, might not be needed for a simple stop signal
              },
              // body: JSON.stringify({}) // Optional body if needed
          });

           if (!response.ok) {
               let errorMsg = `Error stopping session: ${response.status} ${response.statusText}`;
               try { const errorData = await response.json(); errorMsg = errorData.message || errorMsg; } catch (e) { /* ignore */ }
               throw new Error(errorMsg);
           }

           console.log('Stop session request successful');
           // TODO: Reset relevant UI state (e.g., clear steps, set FSM state to IDLE via parent/context)

      } catch (err) {
          console.error('Failed to stop session:', err);
           const errorToShow = err instanceof Error ? err.message : 'An unknown error occurred trying to stop.';
           setStopError(errorToShow);
      } finally {
          setIsStopping(false);
      }
  };

  const pollStatus = async () => {
    try {
      const statusUrl = `${API_BASE_URL}/api/status`;
      const res = await fetch(statusUrl);
      if (res.ok) {
        const data = await res.json();
        setSessionState(data.state);
        // Enable buttons only when state is WAIT_CONFIRM
        const isWaitConfirm = data.state === 'WAIT_CONFIRM';
        setButtonsDisabled(!isWaitConfirm);
        if (isWaitConfirm && data.context?.steps?.length > 0) {
          setIsReviewModalOpen(true);
        }
        if (Array.isArray(data.context?.steps)) {
          setSteps(data.context.steps);
          setCurrentStepIndex(data.context.currentStepIndex || 0);
        }
      }
    } catch (e) {
      console.error('Status polling failed', e);
    }
  };

  useEffect(() => {
    const interval = setInterval(pollStatus, 3000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4 bg-gray-50">
      <div className="w-full max-w-2xl bg-white p-8 rounded-lg shadow-md relative"> {/* Added relative for potential absolute positioning of stop button */}
        <h1 className="text-2xl font-semibold text-center text-gray-800 mb-6">Web Agent Control</h1>

        {/* Stop Session Button */}
         <button
           type="button"
           onClick={handleStopSession}
           className="absolute top-4 right-4 inline-flex items-center justify-center px-3 py-1.5 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 disabled:opacity-50 disabled:cursor-not-allowed"
           disabled={isStopping}
           aria-label="Stop current session"
         >
            {isStopping ? 'Stopping...' : 'Stop Session'}
         </button>
          {stopError && (
              <p className="text-xs text-red-600 absolute top-14 right-4">{stopError}</p> // Simple error display
           )}


        {/* Assuming Instruction Input logic is handled here or via imported component */}
        {/* If using InstructionInput component: <InstructionInput onParseSuccess={...} onParseError={...} /> */}
        {/* For now, duplicating the form logic for demonstration: */}
         <form onSubmit={handleParseSubmit}>
           <label htmlFor="instruction-textarea" className="block text-sm font-medium text-gray-700 mb-1">
             Enter Instruction:
           </label>
           <textarea
             id="instruction-textarea"
             rows={3}
             value={instruction}
             onChange={handleInputChange}
             placeholder="e.g., Go to google.com, search for 'best cat videos', then click the first result."
             className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 disabled:bg-gray-100"
             disabled={isParsing || isStopping} // Disable textarea while parsing or stopping
           />
           {parseError && (
               <p className="mt-1 text-sm text-red-600">{parseError}</p>
           )}
           <button
              type="submit"
              className="mt-3 w-full inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={!instruction.trim() || isParsing || isStopping}
            >
              {isParsing ? 'Parsing...' : 'Parse Instruction'}
            </button>
         </form>

         {/* Integrate StepReviewModal and StatusHUD, passing state */}
         <StepReviewModal
            isOpen={isReviewModalOpen}
            onOpenChange={setIsReviewModalOpen}
            steps={steps}
            currentStepIndex={currentStepIndex}
            onAccept={handleAcceptStep}
            onReject={handleRejectSteps}
            buttonsDisabled={buttonsDisabled}
         />
         <StatusHUD sessionState={sessionState} currentStepIndex={currentStepIndex} totalSteps={steps.length} />
      </div>
    </div>
  );
}

export default App; 