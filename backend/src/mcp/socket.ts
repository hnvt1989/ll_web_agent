const EventSource = require('eventsource');
// console.log('Inspecting EventSource module:', EventSource); // Remove inspection log
import { EventEmitter } from 'events';
import { McpMessage } from '../types/mcp';

// Define the types for the events
export interface McpSseClientEvents {
  open: () => void;
  close: (event: MessageEvent) => void;
  error: (error: Event) => void;
  message: (message: McpMessage) => void;
}

// Use declaration merging to type the EventEmitter
export declare interface McpSseClient {
  on<K extends keyof McpSseClientEvents>(event: K, listener: McpSseClientEvents[K]): this;
  once<K extends keyof McpSseClientEvents>(event: K, listener: McpSseClientEvents[K]): this;
  emit<K extends keyof McpSseClientEvents>(event: K, ...args: Parameters<McpSseClientEvents[K]>): boolean;
  off<K extends keyof McpSseClientEvents>(event: K, listener: McpSseClientEvents[K]): this;
  removeAllListeners<K extends keyof McpSseClientEvents>(event?: K): this;
}

/**
 * Wraps an EventSource connection for MCP communication via SSE.
 */
export class McpSseClient extends EventEmitter {
  private es: EventSource | null = null;
  private url: string;
  private isConnected: boolean = false;

  constructor(url: string) {
    super(); // Call EventEmitter constructor
    // Ensure the URL points to the correct SSE endpoint, e.g., http://.../sse
    this.url = url;
    if (!this.url.endsWith('/sse')) {
        console.warn(`MCP SSE URL "${this.url}" might be missing the /sse endpoint. Appending it.`);
        this.url = this.url.endsWith('/') ? this.url + 'sse' : this.url + '/sse';
    }
  }

  /**
   * Establishes the EventSource connection and sets up event listeners.
   */
  public connect(): void {
    // Use static constants from the class for ready state
    if (this.es && (this.es.readyState === EventSource.EventSource.CONNECTING || this.es.readyState === EventSource.EventSource.OPEN)) {
      console.log(`Already connected or connecting (state: ${this.es.readyState}).`);
      return;
    }

    console.log(`Attempting to connect to SSE endpoint ${this.url}...`);
    
    const options = {}; 

    // Correct instantiation using the nested class
    const Constructor = EventSource.EventSource;
    this.es = new Constructor(this.url, options);

    this.es.onopen = this.handleOpen.bind(this);
    this.es.onmessage = (event: MessageEvent) => this.handleMessage(event); // Default 'message' event
    this.es.onerror = (error: Event) => this.handleError(error);
    
    // Note: EventSource doesn't have an explicit 'onclose' like WebSocket.
    // Closure is typically detected via the 'onerror' event when the connection drops.
  }

  /**
   * Closes the EventSource connection.
   */
  public disconnect(): void {
    console.log('Disconnecting SSE client permanently...');
    if (this.es) {
      this.es.close(); // This stops reconnection attempts
      this.cleanupListeners();
      this.es = null;
      this.isConnected = false; 
      // Manually emit a close-like event if needed by consumers, though it's less defined for SSE
      // this.emit('close', /* appropriate arguments? */); 
    }
  }

  /**
   * MCP is typically client-driven via HTTP POST for calls, and server-driven via SSE for events.
   * This client primarily listens for events. Sending calls would be a separate HTTP request logic.
   * Placeholder for sending, though not standard via SSE itself.
   * @param message The MCP message to send (conceptually).
   */
  public send(message: McpMessage): void {
     console.warn('Sending messages (like MCP calls) is not typically done over the SSE connection.');
     console.warn('Use standard HTTP POST requests to the MCP server for calls.');
     // If there was a specific need, logic would go here, but it deviates from standard SSE patterns.
     // This function might need removal or redesign based on actual MCP interaction flow.
     // For now, just log the intended message for debugging.
     console.log('Intended message (not sent via SSE):', message);
  }

  // --- Private Event Handlers ---

  private handleOpen(): void {
    if (!this.isConnected) { // Emit open only on the first successful connection
        console.log(`SSE Connection opened to ${this.url}`);
        this.isConnected = true;
        this.emit('open');
    } else {
        // EventSource automatically reconnects, this might fire on reconnect
        console.log(`SSE Reconnected to ${this.url}`);
        // Potentially emit a reconnect event if needed
    }
  }

  private handleMessage(event: MessageEvent): void {
    // console.log('Raw SSE message received:', event.data); // Log raw data if needed
    try {
      // Assuming the server sends JSON strings in the data field
      const message = JSON.parse(event.data) as McpMessage; 
      // Basic validation (can be expanded)
      if (message && typeof message === 'object' && 'type' in message) {
         this.emit('message', message);
      } else {
        console.warn('Received malformed SSE message data:', event.data);
      }
    } catch (error) {
      console.error('Failed to parse SSE message data:', event.data, error);
    }
  }

  private handleError(error: Event): void {
    console.error('SSE Error occurred:', error);
    this.emit('error', error);

    // Check if the connection is closed using static constant
    if (this.es && this.es.readyState === EventSource.EventSource.CLOSED) {
        console.log('SSE Connection closed due to error.');
        this.isConnected = false; // Mark as disconnected
        this.cleanupListeners(); // Clean up old listeners before potential reconnect attempt by EventSource
        this.es = null; // Clear reference, EventSource might recreate internally on retry
        this.emit('close', error as MessageEvent); // Emit close on error-induced closure
        // EventSource handles reconnection automatically by default. 
        // We might need logic here if we want to *stop* retrying after N failures.
    }
  }
  
  private cleanupListeners(): void {
      if (this.es) {
          this.es.onopen = null;
          this.es.onmessage = null;
          this.es.onerror = null;
          // Remove any other custom event listeners if added
      }
  }
} 