import * as WebSocket from 'ws';
import { WebSocketServer } from 'ws';
import { Call, Result, Error as McpError, McpMessage } from '../src/types/mcp'; // Adjust path as needed

// Type for canned responses configuration
// Maps method name to a function that returns the result or error payload (without type/id)
type CannedResponsePayload = Omit<Result, 'type' | 'id'> | Omit<McpError, 'type' | 'id'>;
type CannedResponseGenerator = (params: unknown) => CannedResponsePayload;
export type MockServerConfig = Map<string, CannedResponseGenerator>;

/**
 * A lightweight mock Playwright-MCP WebSocket server for offline tests.
 */
export class MockMcpServer {
  private wss: WebSocketServer | null = null;
  private config: MockServerConfig;
  private port: number;
  private clients: Set<WebSocket> = new Set();

  /**
   * @param port The port number for the server to listen on.
   * @param config A map where keys are MCP method names (e.g., 'navigate')
   *               and values are functions that generate the response payload.
   */
  constructor(port: number, config: MockServerConfig = new Map()) {
    this.port = port;
    this.config = config;
  }

  /**
   * Starts the mock WebSocket server.
   * @returns A promise that resolves when the server is listening.
   */
  public start(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.wss) {
        console.warn('Mock server already running.');
        return resolve();
      }

      this.wss = new WebSocketServer({ port: this.port });

      this.wss.on('listening', () => {
        console.log(`Mock MCP Server listening on ws://localhost:${this.port}`);
        resolve();
      });

      this.wss.on('connection', (ws) => {
        console.log('Mock Server: Client connected');
        this.clients.add(ws);

        ws.on('message', (message: WebSocket.RawData, isBinary: boolean) => {
          // Handle both Buffer and potentially other RawData types
          const messageBuffer = Buffer.isBuffer(message) 
                              ? message 
                              : Buffer.from(message as ArrayBuffer); // Convert ArrayBuffer if necessary
          this.handleMessage(ws, messageBuffer, isBinary); // Pass isBinary if needed later
        });

        ws.on('close', () => {
          console.log('Mock Server: Client disconnected');
          this.clients.delete(ws);
        });

        ws.on('error', (error) => {
          console.error('Mock Server: WebSocket error:', error);
          this.clients.delete(ws); // Remove on error as well
        });
      });

      this.wss.on('error', (error) => {
        console.error('Mock Server: Server error:', error);
        this.wss = null; // Ensure server is marked as stopped
        reject(error); // Reject the start promise on server error
      });
    });
  }

  /**
   * Stops the mock WebSocket server.
   * @returns A promise that resolves when the server is closed.
   */
  public stop(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.wss) {
        console.warn('Mock server not running.');
        return resolve();
      }

      console.log('Stopping Mock MCP Server...');
      // Close all client connections first
      this.clients.forEach(client => client.close());
      this.clients.clear();

      this.wss.close((err) => {
        if (err) {
          console.error('Error stopping mock server:', err);
        }
        console.log('Mock MCP Server stopped.');
        this.wss = null;
        resolve();
      });
    });
  }

  /**
   * Updates the canned response configuration.
   * @param config The new configuration map.
   */
  public updateConfig(config: MockServerConfig): void {
    console.log('Updating mock server config...');
    this.config = config;
  }

  /**
   * Broadcasts a message (typically an Event) to all connected clients.
   * @param message The MCP message to broadcast.
   */
  public broadcast(message: McpMessage): void {
    if (!this.wss) return;
    const messageString = JSON.stringify(message);
    this.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(messageString);
      }
    });
  }

  // Add isBinary parameter, though not strictly needed for current JSON logic
  private handleMessage(ws: WebSocket, messageBuffer: Buffer, isBinary?: boolean): void {
    let callMessage: Call;
    try {
      const rawMessage = JSON.parse(messageBuffer.toString());
      // Basic validation
      if (rawMessage?.type !== 'call' || typeof rawMessage.id !== 'number' || typeof rawMessage.method !== 'string') {
        throw new Error('Invalid Call message format');
      }
      callMessage = rawMessage as Call;
      console.log('Mock Server Received:', callMessage);
    } catch (e) {
      console.error('Mock Server: Failed to parse message or invalid format:', messageBuffer.toString(), e);
      // Optionally send a generic error back if possible
      return;
    }

    const responseGenerator = this.config.get(callMessage.method);
    let responsePayload: CannedResponsePayload;

    if (responseGenerator) {
      try {
        responsePayload = responseGenerator(callMessage.params);
      } catch (error: any) {
        console.error(`Error generating response for method ${callMessage.method}:`, error);
        // Send an error back if the generator fails
        responsePayload = {
          error: { code: -32001, message: `Handler error for ${callMessage.method}: ${error.message}` }
        };
      }
    } else {
      // Method not configured
      console.warn(`Mock Server: No canned response configured for method "${callMessage.method}"`);
      responsePayload = {
        error: { code: -32601, message: `Method not found: ${callMessage.method}` }
      };
    }

    let responseMessage: Result | McpError;
    if ('result' in responsePayload) {
      responseMessage = {
        type: 'result',
        id: callMessage.id,
        result: responsePayload.result
      };
    } else { // 'error' in responsePayload
      responseMessage = {
        type: 'error',
        id: callMessage.id, // Respond with the call ID for method errors
        error: responsePayload.error
      };
    }

    console.log('Mock Server Sending:', responseMessage);
    ws.send(JSON.stringify(responseMessage));
  }
}

// Example Usage (optional, can be removed or kept for testing)
/*
async function runExample() {
  const config: MockServerConfig = new Map();
  config.set('navigate', (params: any) => {
    console.log(`Mock navigate called with params:`, params);
    if (!params?.url) {
       return { error: { code: -32602, message: 'Missing url parameter for navigate' } };
    }
    return { result: { success: true, url: params.url } };
  });
  config.set('click', (params: any) => {
    console.log(`Mock click called with params:`, params);
    if (!params?.selector) {
      return { error: { code: -32602, message: 'Missing selector parameter for click' } };
    }
    return { result: { success: true, selector: params.selector } };
  });

  const server = new MockMcpServer(8080, config);
  await server.start();

  // Simulate broadcasting an event after 5 seconds
  setTimeout(() => {
    server.broadcast({ type: 'event', event: 'pageCrashed', params: { reason: 'Mock crash' } });
  }, 5000);

  // Keep server running for a while, or handle shutdown elsewhere
  // setTimeout(async () => {
  //   await server.stop();
  // }, 10000);
}

// runExample(); // Uncomment to run the example when executing this file directly
*/ 