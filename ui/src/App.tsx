import React, { useState } from 'react';

function App() {
  const [instruction, setInstruction] = useState('');
  const [isParsing, setIsParsing] = useState(false); // Renamed from isLoading for clarity
  const [parseError, setParseError] = useState<string | null>(null);
  const [isStopping, setIsStopping] = useState(false);
  const [stopError, setStopError] = useState<string | null>(null);

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
      const response = await fetch('/api/parse', { // Assuming InstructionInput is merged or this logic lives here now
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
      console.log('Parsing successful:', parsedData);
      // TODO: Update UI state with parsed steps (passed to StepReviewModal, StatusHUD etc.)
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
          const response = await fetch('/api/stop', {
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

         {/* TODO: Integrate StepReviewModal and StatusHUD, passing state */}
         {/* <StepReviewModal isOpen={...} steps={...} ... /> */}
         {/* <StatusHUD sessionState={...} currentStepIndex={...} totalSteps={...} /> */}
      </div>
    </div>
  );
}

export default App; 