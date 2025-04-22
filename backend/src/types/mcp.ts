/**
 * Represents a remote procedure call message.
 */
export interface Call {
  type: 'call';
  id: number;
  method: string;
  params?: unknown;
}

/**
 * Represents a successful result of a call.
 */
export interface Result {
  type: 'result';
  id: number;
  result: unknown;
}

/**
 * Represents an error response to a call.
 */
export interface Error {
  type: 'error';
  id: number | null; // Null id for general errors not tied to a specific call
  error: {
    code: number;
    message: string;
    data?: unknown; // Optional additional error data
  };
}

/**
 * Represents an event notification from the server.
 */
export interface Event {
  type: 'event';
  event: string;
  params?: unknown;
}

/**
 * Union type for all possible MCP messages.
 */
export type McpMessage = Call | Result | Error | Event; 