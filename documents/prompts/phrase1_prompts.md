# Phrase1 Prompts

## Prompt 1.1 — MCP Types
```text
Implement TypeScript interfaces for MCP messages (`Call`, `Result`, `Error`, `Event`).
File: `backend/src/types/mcp.ts`.
Return only that file.
```

## Prompt 1.2 — WebSocket Wrapper Skeleton
```text
Install the `ws` library and create `backend/src/mcp/socket.ts` containing a `McpSocket` class skeleton with connect, disconnect, and send methods.
Return the full file.
```

## Prompt 1.3 — WebSocket Wrapper (Reconnect & Events)
```text
Extend `McpSocket` to reconnect with exponential backoff and emit typed events using `EventEmitter`.
Return the updated `socket.ts` file.
```

## Prompt 1.4 — Mock MCP Server
```text
Create a lightweight mock Playwright‑MCP WebSocket server for offline tests in `backend/test/mockServer.ts`.
The server should allow a configurable set of canned responses for `navigate`, `click`, etc.
Return the file.
```
