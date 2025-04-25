import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { Orchestrator } from './orchestrator/Orchestrator';
import { OrchestratorState } from './orchestrator/fsm';
import { OrchestratorEvent } from './orchestrator/fsm';

const app = express();
const PORT = process.env.PORT || 3000;

// --- Environment Variables --- 
// const MCP_SERVER_WS_URL = process.env.MCP_SERVER_WS; // Get MCP URL from environment
// const MCP_SERVER_SSE_URL = process.env.MCP_SERVER_SSE_URL; // Get MCP SSE URL from environment
const MCP_SERVER_BASE_URL = process.env.MCP_SERVER_BASE_URL; // Get MCP base URL from environment

// if (!MCP_SERVER_WS_URL) {
if (!MCP_SERVER_BASE_URL) {
    // console.error('Error: MCP_SERVER_WS environment variable is not set.');
    console.error('Error: MCP_SERVER_BASE_URL environment variable is not set.');
    process.exit(1); // Exit if MCP URL is missing
}

// --- Instantiate Orchestrator (Singleton for simplicity) ---
// const orchestrator = new Orchestrator(MCP_SERVER_WS_URL);
const orchestrator = new Orchestrator(MCP_SERVER_BASE_URL); // Pass base URL

// --- Middleware ---
// Enable CORS for all origins (adjust for production if needed)
app.use(cors());
// Parse JSON request bodies
app.use(express.json());

// Basic logging middleware (optional)
app.use((req: Request, res: Response, next: NextFunction) => {
  // logger.info(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
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
    // logger.warn('Invalid request to /api/parse: Missing or invalid instruction.');
    console.warn('Invalid request to /api/parse: Missing or invalid instruction.');
    return res.status(400).json({ error: 'Missing or invalid \'instruction\' in request body' });
  }

  // logger.info(`Received instruction to parse and start session: "${instruction}"`);
  console.log(`Received instruction to parse and start session: "${instruction}"`);

  try {
    // Call orchestrator to start the session and parse
    const result = await orchestrator.startSession(instruction);
    // Return the parsed steps for the UI to display in the modal
    // logger.info('Session started and instruction parsed successfully.');
    console.log('Session started and instruction parsed successfully.');
    // Filter out browser_snapshot steps before sending to UI
    const filteredSteps = result.steps.filter(step => step.tool_name !== 'browser_snapshot');
    res.status(200).json({ steps: filteredSteps }); 

  } catch (error: any) {
    // logger.error({ err: error, instruction }, 'Error during instruction parsing/session start');
    console.error('Error during instruction parsing/session start', { err: error, instruction });
    // Determine appropriate status code based on error type if needed
    res.status(500).json({ error: 'Failed to parse instruction or start session', details: error.message });
  }
});

// API route for confirming a step
app.post('/api/confirm', (req: Request, res: Response) => {
    const { stepId } = req.body;

    if (!stepId || typeof stepId !== 'string') {
        // return res.status(400).json({ error: 'Missing or invalid \'stepId\' in request body' });
        // For now, let's proceed even without stepId as FSM doesn't strictly need it
        // logger.warn("[/api/confirm] Received confirmation without a stepId.");
        console.warn("[/api/confirm] Received confirmation without a stepId.");
    }

    try {
        orchestrator.handleConfirmStep(); // Use the new public method
        // Respond quickly - the actual result comes via state updates (or polling /status for now)
        // logger.info('Step confirmation processed.');
        console.log('Step confirmation processed.');
        res.status(202).json({ message: 'Confirmation received, processing.' }); 
    } catch (error: any) {
        // logger.error({ err: error }, 'Error confirming step');
        console.error('Error confirming step', { err: error });
        res.status(500).json({ error: 'Failed to confirm step', details: error.message });
    }
});

// API route for rejecting the current step sequence
app.post('/api/reject', (req: Request, res: Response) => {
    try {
        // orchestrator.rejectSteps();
        orchestrator.handleRejectStep(); // Use the new public method
        // logger.info('Session rejected/cancelled.');
        console.log('Session rejected/cancelled.');
        res.status(200).json({ message: 'Session rejected/cancelled.' }); 
    } catch (error: any) {
        // logger.error({ err: error }, 'Error rejecting steps');
        console.error('Error rejecting steps', { err: error });
        res.status(500).json({ error: 'Failed to reject steps', details: error.message });
    }
});

// API route for cancelling the session (e.g., Stop button)
app.post('/api/cancel', (req: Request, res: Response) => {
     try {
        // orchestrator.cancelSession();
        orchestrator.handleCancelSession(); // Use the new public method
        // logger.info('Session cancelled.');
        console.log('Session cancelled.');
        res.status(200).json({ message: 'Session cancelled.' }); 
    } catch (error: any) {
        // logger.error({ err: error }, 'Error cancelling session');
        console.error('Error cancelling session', { err: error });
        res.status(500).json({ error: 'Failed to cancel session', details: error.message });
    }
});

// API route to get the current orchestrator status (for polling by UI)
app.get('/api/status', (req: Request, res: Response) => {
    try {
        const status = orchestrator.getStatus(); // Use the new public method
        // logger.info('Status retrieved successfully.');
        console.log('Status retrieved successfully.');
        // Filter out browser_snapshot steps from the context before sending to UI
        const filteredContextSteps = status.context.steps.filter(step => step.tool_name !== 'browser_snapshot');
        const filteredStatus = {
            ...status,
            context: {
                ...status.context,
                steps: filteredContextSteps
            }
        };
        res.status(200).json(filteredStatus);
    } catch (error: any) {
         // logger.error({ err: error }, 'Error getting status');
         console.error('Error getting status', { err: error });
        res.status(500).json({ error: 'Failed to get status', details: error.message });
    }
});

// --- Error Handling Middleware (optional but recommended) ---
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  // logger.error({ err: err }, 'Unhandled error');
  console.error('Unhandled error', { err: err });
  res.status(500).json({ error: 'Internal Server Error' });
});

// --- Start Server ---
app.listen(PORT, () => {
  // logger.info(`Backend server listening on port ${PORT}`);
  console.log(`Backend server listening on port ${PORT}`);
  // logger.info(`Connecting to MCP Server at: ${MCP_SERVER_WS_URL}`);
  // logger.info(`Connecting to MCP Server (Base URL for calls: ${MCP_SERVER_BASE_URL})`); // Update log message
  console.log(`Connecting to MCP Server (Base URL for calls: ${MCP_SERVER_BASE_URL})`);
}); 