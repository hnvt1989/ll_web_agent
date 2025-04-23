import React, { useState } from 'react';

interface InstructionInputProps {
  // Optional callback for when parsing is successful
  onParseSuccess?: (parsedSteps: any) => void; // eslint-disable-line @typescript-eslint/no-explicit-any
  // Optional callback for when parsing fails
  onParseError?: (error: Error) => void;
}

function InstructionInput({ onParseSuccess, onParseError }: InstructionInputProps) {
  const [instruction, setInstruction] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleInputChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInstruction(event.target.value);
    if (error) {
      setError(null); // Clear error when user types again
    }
  };

  const handleParseClick = async () => {
    if (!instruction.trim()) {
      return; // Don't send empty instructions
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/parse', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ instruction }),
      });

      if (!response.ok) {
        // Attempt to read error message from backend if available
        let errorMsg = `Error: ${response.status} ${response.statusText}`;
        try {
            const errorData = await response.json();
            errorMsg = errorData.message || errorMsg;
        } catch (e) {
            // Ignore if response body is not JSON or empty
        }
        throw new Error(errorMsg);
      }

      const parsedData = await response.json();
      console.log('Parsing successful:', parsedData);

      // Call the success callback if provided
      if (onParseSuccess) {
        onParseSuccess(parsedData.steps || parsedData); // Assuming steps are in parsedData.steps or root
      }
       // Optionally clear input on success
       // setInstruction('');

    } catch (err) {
      console.error('Parsing failed:', err);
      const errorToShow = err instanceof Error ? err.message : 'An unknown error occurred during parsing.';
      setError(errorToShow);
      // Call the error callback if provided
      if (onParseError && err instanceof Error) {
        onParseError(err);
      } else if (onParseError) {
        onParseError(new Error(errorToShow));
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="w-full">
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
        disabled={isLoading}
      />
      {error && (
          <p className="mt-1 text-sm text-red-600">{error}</p>
      )}
      <button
        type="button" // Important: Use type="button" if not inside a form submitting traditionally
        onClick={handleParseClick}
        className="mt-3 w-full inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
        disabled={!instruction.trim() || isLoading}
      >
        {isLoading ? 'Parsing...' : 'Parse'}
      </button>
    </div>
  );
}

export default InstructionInput; 