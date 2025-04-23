import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { McpMessage } from '../types/mcp';

// Define the types for the events
export interface McpSocketEvents {
  open: () => void;
  close: (code: number, reason: Buffer) => void;
  error: (error: Error) => void;
  message: (message: McpMessage) => void;
  reconnecting: (attempt: number, delay: number) => void;
}

// Use declaration merging to type the EventEmitter
export declare interface McpSocket {
  on<K extends keyof McpSocketEvents>(event: K, listener: McpSocketEvents[K]): this;
  once<K extends keyof McpSocketEvents>(event: K, listener: McpSocketEvents[K]): this;
  emit<K extends keyof McpSocketEvents>(event: K, ...args: Parameters<McpSocketEvents[K]>): boolean;
  off<K extends keyof McpSocketEvents>(event: K, listener: McpSocketEvents[K]): this;
  removeAllListeners<K extends keyof McpSocketEvents>(event?: K): this;
}

/**
 * Wraps a WebSocket connection to provide MCP-specific functionality,
 * including automatic reconnection and typed events.
 */
export class McpSocket extends EventEmitter {
  private ws: WebSocket | null = null;
  private url: string;
  private shouldReconnect: boolean = true;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 10; // Configurable?
  private initialReconnectDelay: number = 1000; // 1 second
  private maxReconnectDelay: number = 30000; // 30 seconds
  private reconnectDelayFactor: number = 1.5; // Exponential backoff factor
  private reconnectTimer: NodeJS.Timeout | null = null;

  constructor(url: string, maxAttempts = 10, initialDelay = 1000, maxDelay = 30000) {
    super(); // Call EventEmitter constructor
    this.url = url;
    this.maxReconnectAttempts = maxAttempts;
    this.initialReconnectDelay = initialDelay;
    this.maxReconnectDelay = maxDelay;
  }

  /**
   * Establishes the WebSocket connection and sets up event listeners.
   */
  public connect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      console.log(`Already connected or connecting (state: ${this.ws.readyState}).`);
      return;
    }

    console.log(`Attempting to connect to ${this.url}... (Attempt ${this.reconnectAttempts + 1})`);
    this.shouldReconnect = true; // Allow reconnection attempts by default
    this.clearReconnectTimer(); // Clear any existing timer

    this.ws = new WebSocket(this.url);

    this.ws.on('open', this.handleOpen.bind(this));
    this.ws.on('message', (data: WebSocket.RawData) => this.handleMessage(data));
    this.ws.on('close', (code: number, reason: Buffer) => this.handleClose(code, reason));
    this.ws.on('error', (error: Error) => this.handleError(error));
  }

  /**
   * Closes the WebSocket connection permanently.
   */
  public disconnect(): void {
    console.log('Disconnecting permanently...');
    this.shouldReconnect = false; // Prevent automatic reconnection
    this.clearReconnectTimer();
    if (this.ws) {
      this.ws.removeAllListeners(); // Clean up listeners
      this.ws.close();
      this.ws = null;
    }
    this.reconnectAttempts = 0; // Reset attempts
  }

  /**
   * Sends an MCP message over the WebSocket.
   * @param message The MCP message to send.
   */
  public send(message: McpMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      // console.log('Sending message:', message); // Can be verbose
      this.ws.send(JSON.stringify(message));
    } else {
      console.error('WebSocket is not open. Cannot send message.');
      // Optionally queue the message or throw an error
    }
  }

  // --- Private Event Handlers ---

  private handleOpen(): void {
    console.log(`Connected to ${this.url}`);
    this.resetReconnectState();
    this.emit('open');
  }

  private handleMessage(data: WebSocket.RawData): void {
    try {
      const message = JSON.parse(data.toString()) as McpMessage;
      // Basic validation (can be expanded)
      if (message && typeof message === 'object' && 'type' in message) {
         this.emit('message', message);
      } else {
        console.warn('Received malformed message:', data.toString());
      }
    } catch (error) {
      console.error('Failed to parse message:', error);
    }
  }

  private handleClose(code: number, reason: Buffer): void {
    console.log(`WebSocket closed. Code: ${code}, Reason: ${reason.toString()}`);
    this.ws?.removeAllListeners(); // Clean up listeners on the closed socket
    this.ws = null;
    this.emit('close', code, reason);
    if (this.shouldReconnect) {
      this.scheduleReconnect();
    }
  }

  private handleError(error: Error): void {
    console.error('WebSocket error:', error.message);
    this.emit('error', error);
    // WebSocket often emits 'close' after 'error', so reconnect logic is usually handled in handleClose.
    // However, some errors might warrant immediate close/reconnect attempt.
    // For simplicity, we rely on the 'close' event for reconnection for now.
     if (this.ws && (this.ws.readyState === WebSocket.CLOSING || this.ws.readyState === WebSocket.CLOSED)) {
       // Already closing or closed, handleClose will manage reconnect
     } else {
       // Unexpected error while open/connecting, might need forceful close/reconnect
       this.ws?.terminate(); // Force close if necessary
     }
  }

  // --- Private Reconnect Logic ---

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error(`Max reconnect attempts (${this.maxReconnectAttempts}) reached. Giving up.`);
      this.shouldReconnect = false; // Stop trying
      return;
    }

    const delay = Math.min(
      this.initialReconnectDelay * Math.pow(this.reconnectDelayFactor, this.reconnectAttempts),
      this.maxReconnectDelay
    );

    this.reconnectAttempts++;
    console.log(`Scheduling reconnect attempt ${this.reconnectAttempts} in ${delay}ms`);
    this.emit('reconnecting', this.reconnectAttempts, delay);


    this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null; // Clear the stored timer ID *before* attempting connect
        this.connect();
    }, delay);
  }

  private resetReconnectState(): void {
    this.reconnectAttempts = 0;
    this.clearReconnectTimer();
    // this.shouldReconnect remains true unless disconnect() is called
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
} 