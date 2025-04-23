import React from 'react';

// It's good practice to use the same enum/type as the backend if possible,
// but for now, we'll define the expected states as strings.
type SessionState = 'IDLE' | 'REVIEW' | 'WAIT_CONFIRM' | 'EXECUTE' | 'ERROR' | string;

interface StatusHUDProps {
  sessionState: SessionState;
  currentStepIndex: number; // 0-based index
  totalSteps: number;
}

function StatusHUD({ sessionState, currentStepIndex, totalSteps }: StatusHUDProps) {

  const getStatusText = (): string => {
    switch (sessionState) {
      case 'IDLE':
        return 'Idle: Ready for instruction.';
      case 'REVIEW':
        return 'Parsing instruction...';
      case 'WAIT_CONFIRM':
        return `Waiting for confirmation... (Step ${currentStepIndex + 1}/${totalSteps})`;
      case 'EXECUTE':
        return `Executing step ${currentStepIndex + 1}/${totalSteps}...`;
      case 'ERROR':
        return 'Error occurred. Session halted.';
      default:
        return `Status: ${sessionState}`;
    }
  };

  const getStatusColor = (): string => {
     switch (sessionState) {
      case 'IDLE':
        return 'bg-gray-500';
      case 'REVIEW':
        return 'bg-blue-500';
      case 'WAIT_CONFIRM':
        return 'bg-yellow-500 text-black'; // Yellow might need black text
      case 'EXECUTE':
        return 'bg-green-500';
      case 'ERROR':
        return 'bg-red-600';
      default:
        return 'bg-gray-700';
    }
  }

  return (
    <div className={`fixed bottom-4 right-4 p-3 rounded-lg shadow-lg text-white text-sm ${getStatusColor()}`}>
      <p className="font-medium">{getStatusText()}</p>
      {/* Optionally add more details like retry count if available */}
    </div>
  );
}

export default StatusHUD; 