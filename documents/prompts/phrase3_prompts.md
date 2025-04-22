# Phrase3 Prompts

## Prompt 3.1 — FSM Skeleton
```text
Add XState or custom FSM in `backend/src/orchestrator/fsm.ts` with states IDLE, REVIEW, WAIT_CONFIRM, EXECUTE, ERROR.
Return that file.
```

## Prompt 3.2 — Timeouts & Retries
```text
Extend the FSM to include confirmation timeout (120 000 ms) and retry counter (max 2).
Return the updated `fsm.ts` file.
```

## Prompt 3.3 — Event Routing
```text
Implement event handlers in `backend/src/orchestrator/events.ts` that translate MCP RESULT/ERROR payloads into FSM transitions.
Return the file.
```
