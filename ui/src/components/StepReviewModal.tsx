import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"; // Adjust path if needed
import { Button } from "@/components/ui/button"; // Adjust path if needed

// Re-define or import the step structure
interface McpToolCall {
    tool_call_id: string;
    tool_name: string;
    arguments: { [key: string]: any };
}

interface StepReviewModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  steps: McpToolCall[];
  currentStepIndex: number; // Index of the step to review
  onAccept: (stepId: string) => void; // Callback with the ID of the accepted step
  onReject: () => void; // Callback if the user rejects/cancels
}

function StepReviewModal({
  isOpen,
  onOpenChange,
  steps,
  currentStepIndex,
  onAccept,
  onReject,
}: StepReviewModalProps) {

  // Ensure the current step index is valid
  const currentStep = (currentStepIndex >= 0 && currentStepIndex < steps.length)
    ? steps[currentStepIndex]
    : null;

  const handleAccept = () => {
    if (currentStep) {
      onAccept(currentStep.tool_call_id);
    }
  };

  const handleReject = () => {
    onReject();
  };

  // Prevent rendering if the step index is invalid or no step data
  if (!currentStep) {
      // Optionally log an error or handle this case differently
      if (isOpen && steps.length > 0) {
          console.error(`StepReviewModal: Invalid currentStepIndex (${currentStepIndex}) for steps array length (${steps.length})`);
      }
      // Don't render the dialog if there's no valid step to show
      return null;
  }


  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Confirm Step {currentStepIndex + 1} of {steps.length}</DialogTitle>
          <DialogDescription>
            Please review the details of the next action before execution.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          {/* Display current step details */}
          <div className="rounded-md border p-4 bg-gray-50">
              <p className="text-sm font-medium text-gray-800">
                  Action: <span className="font-bold text-indigo-600">{currentStep.tool_name}</span>
              </p>
              <p className="mt-2 text-sm text-gray-600">Arguments:</p>
              <pre className="mt-1 p-2 bg-gray-100 rounded text-xs text-gray-700 overflow-x-auto">
                  {JSON.stringify(currentStep.arguments, null, 2)}
              </pre>
          </div>
          {/* Optional: Display upcoming steps for context? */}
          {/* {steps.length > currentStepIndex + 1 && (
              <div className="mt-4">
                  <p className="text-xs text-gray-500">Upcoming steps:</p>
                   <ul className="list-disc list-inside text-xs text-gray-400">
                       {steps.slice(currentStepIndex + 1).map((step, index) => (
                           <li key={step.tool_call_id || index}>{step.tool_name}</li>
                       ))}
                   </ul>
              </div>
          )} */}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleReject}>Reject / Cancel</Button>
          <Button onClick={handleAccept}>Accept Step</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default StepReviewModal; 