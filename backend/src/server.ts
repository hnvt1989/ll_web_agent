import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { Orchestrator } from './orchestrator/Orchestrator';
import { OrchestratorState } from './orchestrator/fsm';

const app = express();
const PORT = process.env.PORT || 3000;

// --- Environment Variables --- 
const MCP_SERVER_WS_URL = process.env.MCP_SERVER_WS; // Get MCP URL from environment

if (!MCP_SERVER_WS_URL) {
    console.error('Error: MCP_SERVER_WS environment variable is not set.');
    process.exit(1); // Exit if MCP URL is missing
}

// --- Instantiate Orchestrator (Singleton for simplicity) ---
const orchestrator = new Orchestrator(MCP_SERVER_WS_URL);

// --- Middleware ---
// Enable CORS for all origins (adjust for production if needed)
app.use(cors());
// Parse JSON request bodies
app.use(express.json());

// Basic logging middleware (optional)
app.use((req: Request, res: Response, next: NextFunction) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// --- Routes ---

// Root route for basic health check
app.get('/', (req: Request, res: Response) => {
  res.status(200).json({ message: 'Backend server is running' });
});

// API route for starting a session (parsing instruction)
app.post('/api/parse', async (req: Request, res: Response) => {
  const { instruction } = req.body;

  if (!instruction || typeof instruction !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid \'instruction\' in request body' });
  }

  console.log(`Received instruction to parse and start session: "${instruction}"`);

  try {
    // Call orchestrator to start the session and parse
    const result = await orchestrator.startSession(instruction);
    // Return the parsed steps for the UI to display in the modal
    res.status(200).json({ steps: result.steps }); 

  } catch (error: any) {
    console.error('Error during instruction parsing/session start:', error);
    // Determine appropriate status code based on error type if needed
    res.status(500).json({ error: 'Failed to parse instruction or start session', details: error.message });
  }
});

// API route for confirming a step
app.post('/api/confirm', (req: Request, res: Response) => {
    const { stepId } = req.body;

    if (!stepId || typeof stepId !== 'string') {
        return res.status(400).json({ error: 'Missing or invalid \'stepId\' in request body' });
    }

    try {
        orchestrator.confirmStep(stepId);
        // Respond quickly - the actual result comes via state updates (or polling /status for now)
        res.status(202).json({ message: 'Confirmation received, processing.' }); 
    } catch (error: any) {
        console.error('Error confirming step:', error);
        res.status(500).json({ error: 'Failed to confirm step', details: error.message });
    }
});

// API route for rejecting the current step sequence
app.post('/api/reject', (req: Request, res: Response) => {
    try {
        orchestrator.rejectSteps();
        res.status(200).json({ message: 'Session rejected/cancelled.' }); 
    } catch (error: any) {
        console.error('Error rejecting steps:', error);
        res.status(500).json({ error: 'Failed to reject steps', details: error.message });
    }
});

// API route for cancelling the session (e.g., Stop button)
app.post('/api/cancel', (req: Request, res: Response) => {
     try {
        orchestrator.cancelSession();
        res.status(200).json({ message: 'Session cancelled.' }); 
    } catch (error: any) {
        console.error('Error cancelling session:', error);
        res.status(500).json({ error: 'Failed to cancel session', details: error.message });
    }
});

// API route to get the current orchestrator status (for polling by UI)
app.get('/api/status', (req: Request, res: Response) => {
    try {
        const status = orchestrator.getStatus();
        res.status(200).json(status);
    } catch (error: any) {
         console.error('Error getting status:', error);
        res.status(500).json({ error: 'Failed to get status', details: error.message });
    }
});

// --- Error Handling Middleware (optional but recommended) ---
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal Server Error' });
});

// --- Start Server ---
app.listen(PORT, () => {
  console.log(`Backend server listening on port ${PORT}`);
  console.log(`Connecting to MCP Server at: ${MCP_SERVER_WS_URL}`);
}); 