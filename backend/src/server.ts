import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { parseInstruction } from './parser/parseInstruction';
// Assuming fallbackParser might be needed later or as part of a combined strategy
// import { fallbackParser } from './parser/fallback';

const app = express();
const PORT = process.env.PORT || 3000;

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

// API route for parsing instructions
app.post('/api/parse', async (req: Request, res: Response) => {
  const { instruction } = req.body;

  if (!instruction || typeof instruction !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid \'instruction\' in request body' });
  }

  console.log(`Received instruction to parse: "${instruction}"`);

  try {
    // Call the primary parser
    const parsedSteps = await parseInstruction(instruction);

    // Optional: Implement fallback logic if primary parser returns empty/insufficient steps
    // if (!parsedSteps || parsedSteps.length === 0) {
    //   console.log('Primary parser returned no steps, trying fallback...');
    //   const fallbackSteps = fallbackParser(instruction);
    //   if (fallbackSteps.length > 0) {
    //     console.log('Fallback parser succeeded.');
    //     return res.status(200).json({ steps: fallbackSteps });
    //   }
    // }

    if (!parsedSteps || parsedSteps.length === 0) {
      console.log('Parser did not return any steps for instruction.');
      // Return success but with an empty array or a specific message
      return res.status(200).json({ steps: [] });
    }

    console.log(`Parser returned ${parsedSteps.length} steps.`);
    res.status(200).json({ steps: parsedSteps });

  } catch (error: any) {
    console.error('Error during instruction parsing:', error);
    res.status(500).json({ error: 'Failed to parse instruction', details: error.message });
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
}); 