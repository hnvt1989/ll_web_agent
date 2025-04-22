# Build Blueprint & LLM Prompts for MCP‑Powered NL Web Automation Tool

---

## Part A — High‑Level Blueprint

| Phase | Goal | Key Deliverables |
|-------|------|------------------|
| **0 — Project Foundation** | Create a clean, enforceable, monorepo baseline. | pnpm workspace, TS configs, ESLint/Prettier, Husky hooks, CI skeleton. |
| **1 — MCP Connectivity Layer** | Isolate all Model Context Protocol plumbing. | Typed WebSocket client, `toolCall()` helper, reconnect & heartbeat logic, mocks for offline tests. |
| **2 — Instruction Parser** | Convert NL → ordered `tool_call` list (≤ 10). | Prompt templates, streaming parse, fallback heuristics, unit tests. |
| **3 — Step Orchestrator** | Manage confirmation → execution cycle. | Finite‑state machine, retry/timeout logic, error surfacing. |
| **4 — Control UI** | React app to capture input + drive sessions. | NL input form, step review modal, status HUD, Stop Session btn. |
| **5 — Browser Overlay** | Visual feedback inside real browser. | Playwright‑MCP overlay injection, highlight/scroll helpers. |
| **6 — E2E Pipeline** | Validate the whole stack headless + visible. | Docker‑Compose env, Playwright tests, CI workflow. |
| **7 — Packaging & Docs** | Ship it + explain it. | Versioned Docker images, README, Architecture diagram. |

---

## Part B — Iterative Chunking

Below each phase is broken into **iterative chunks** (≈ 1–3 dev‑days each).

### Phase 0 — Project Foundation
- **0.1** Bootstrap pnpm workspace with `backend/` & `ui/` packages.
- **0.2** Add TypeScript configs; enable strict mode.
- **0.3** Install ESLint + Prettier; share config via `@config/eslint` pkg.
- **0.4** Configure Husky pre‑commit hook (`lint`, `test --watch=false`).
- **0.5** Set up GitHub Actions: `lint`, `build`, `test`.

### Phase 1 — MCP Connectivity Layer
- **1.1** Define TypeScript types for base MCP messages (`CALL`, `EVENT`, `RESULT`, `ERROR`).
- **1.2** Create lightweight WebSocket wrapper with auto‑reconnect.
- **1.3** Implement `toolCall<T>` generic that returns a typed Promise.
- **1.4** Expose mock Playwright‑MCP server using `ws` + fixtures for unit tests.

### Phase 2 — Instruction Parser
- **2.1** Draft system + user prompt templates (few‑shot examples of tasks ⇒ tool calls).
- **2.2** Implement streaming completion via OpenAI SDK; parse JSON chunks.
- **2.3** Add heuristic fallback (regex for `go to <url>` etc.) if LLM parse fails.
- **2.4** Write unit tests for 10‑step limit, unsupported verbs, partial parses.

### Phase 3 — Step Orchestrator
- **3.1** Model a finite‑state machine: `IDLE → REVIEW → WAIT_CONFIRM → EXECUTE`.
- **3.2** Wire confirmation timeouts (2 min) & retries (2) into FSM.
- **3.3** Route SUCCESS/ERROR events from MCP client back into FSM.

### Phase 4 — Control UI
- **4.1** Scaffold Vite + React + Tailwind project.
- **4.2** Implement NL input + “Parse” button; show parsed step list.
- **4.3** Build Step Review modal with Accept / Reject buttons.
- **4.4** Display live status HUD (idle, executing step n, error).
- **4.5** Add \"Stop Session\" and websocket‑disconnect handling.

### Phase 5 — Browser Overlay
- **5.1** Implement overlay CSS/JS snippet injected via Playwright‑MCP `evaluate`.
- **5.2** Highlight target element before click; scroll into view.
- **5.3** Remove overlay when step completes or on error.

### Phase 6 — E2E Pipeline
- **6.1** Write Playwright E2E test: “Navigate to example.com & assert text.”
- **6.2** Add Docker‑Compose: backend, ui, playwright‑mcp.
- **6.3** GitHub Actions job: spin containers, run E2E suite headless.

### Phase 7 — Packaging & Docs
- **7.1** Prepare multi‑stage Dockerfiles (deps → build → runtime).
- **7.2** Publish `:latest` image to GHCR.
- **7.3** Create README with architecture diagram + quick‑start snippets.

---

## Part C — Micro‑Steps (Safely Sized)

Each chunk is further split into 30‑🡒90‑minute **micro‑steps**. Example for Phase 1:

| Chunk | Micro‑Step | Output |
|-------|-----------|--------|
|1.1| M1 – Create `types/mcp.ts` with base interfaces.| `backend/src/types/mcp.ts`|
|1.1| M2 – Add `npm run typecheck` script.| `package.json`|
|1.2| M3 – Install `ws` & write `McpSocket` class skeleton.| `backend/src/mcp/socket.ts`|
|1.2| M4 – Implement heartbeat ping every 15 s.| same file|
|1.3| M5 – Write `toolCall` generic fn + tests.| `backend/src/mcp/toolCall.ts`|
|1.4| M6 – Spin up mock server fixture in Jest setup.| `backend/test/mockServer.ts`|

(Similar micro‑step tables exist for all other chunks but omitted here for brevity.)

---

## Part D — Code‑Gen LLM Prompts

**Pattern:** Each prompt references the repo path to touch, gives constraints, and finishes with _\"return the full code block(s) only\"_.

### Prompt 0.1 — Bootstrap Workspace
```text
You are ChatGPT‑Coder. Task: create a pnpm monorepo with two packages: `backend` and `ui`. Use TypeScript 5, Node 18, and React 18.
• Generate `package.json` at the root with `workspaces` array.
• Scaffold `backend/package.json` and `ui/package.json` with minimal scripts.
• Do not install deps yet.
Return all three JSON files in separate ```json blocks.
```

### Prompt 0.2 — Add TypeScript Configs
```text
Add strict `tsconfig.json` files to root and each package.
Root extends `@tsconfig/strictest/tsconfig.json` and sets `composite: true`.
Backend config targets Node 18; UI targets `dom` libs. Return three ```json blocks.
```

### Prompt 0.3 — ESLint & Prettier Setup
```text
Create shared ESLint + Prettier config inside `packages/config/eslint/`.
Include TypeScript, React, and Prettier plugins. Return config files and update npm scripts.
```

### Prompt 1.1 — MCP Types
```text
Implement TypeScript interfaces for MCP messages (`Call`, `Result`, `Error`, `Event`). File: `backend/src/types/mcp.ts`. Return only that file.
```

### Prompt 1.3 — WebSocket Wrapper
```text
Implement `McpSocket` class in `backend/src/mcp/socket.ts`.
• Connects to `process.env.MCP_SERVER_WS`.
• Reconnect with exponential backoff.
• Emits typed events using `EventEmitter`.
Return full file.
```

### Prompt 2.1 — Parser Prompt Template
```text
Create prompt templates in `backend/src/parser/prompts.ts`.
• System prompt: \"You are a parsing engine...\" (see spec).
• Few‑shot examples mapping NL → JSON tool calls.
Return the file.
```

### Prompt 2.2 — Streaming Completion
```text
Implement `parseInstruction()` that streams OpenAI responses (function call mode) and assembles JSON.
```

### Prompt 3.1 — FSM Skeleton
```text
Add XState or custom FSM in `backend/src/orchestrator/fsm.ts` with states IDLE, REVIEW, WAIT_CONFIRM, EXECUTE, ERROR.
```

### Prompt 4.1 — Vite + React Scaffold
```text
Generate minimal Vite React + Tailwind app in `ui/` with index page and App.tsx showing a single input.
```

### Prompt 4.3 — Step Review Modal
```text
Using shadcn/ui Dialog, create `StepReviewModal.tsx` that receives `steps[]` and callbacks `onAccept(stepId)` / `onReject()`.
```

### Prompt 5.1 — Overlay Snippet
```text
Write JS/CSS snippet injected via Playwright `page.addScriptTag` that highlights a DOM element and scrolls into view.
Return the snippet string constant in `backend/src/overlay/snippet.ts`.
```

### Prompt 6.1 — E2E Test
```text
Create Playwright test `e2e/basicFlow.spec.ts` that spins up backend + ui via Docker and validates navigating to example.com.
```

### Prompt 7.1 — Dockerfile
```text
Author multi‑stage Dockerfile at repo root building backend and ui, and running backend on port 3000 with static ui serving.
```

*(Continue prompts for all remaining micro‑steps; maintain numbering so each prompt builds on prior work.)*

---

## Part E — Next Actions
1. **Review this blueprint**: confirm phases, chunk sizing, and prompt format.
2. **Iterate**: request adjustments (add tests, change stack, etc.).
3. **Start prompting**: kick off with Prompt 0.1.

---

*End of document*
