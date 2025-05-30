# TODO Checklist

- [X] **0 — Project Foundation**
    - [ ] 0.1 Bootstrap monorepo
        - [ ] Create root package.json with workspaces
        - [ ] Scaffold backend/package.json
        - [ ] Scaffold ui/package.json
    - [ ] 0.2 TypeScript configuration
        - [ ] Add root tsconfig.json (strictest)
        - [ ] Add backend tsconfig.json (Node 18 target)
        - [ ] Add ui tsconfig.json (DOM libs)
    - [ ] 0.3 Linting & formatting
        - [ ] Create shared ESLint config
        - [ ] Create shared Prettier config
        - [ ] Add npm scripts (`lint`, `format`)
    - [ ] 0.4 Husky pre‑commit
        - [ ] Install Husky and set up git hooks
        - [ ] Configure pre‑commit to run lint & test
    - [ ] 0.5 GitHub Actions CI
        - [ ] Add workflow for lint/build/test
        - [ ] Verify CI passes on main branch

- [X] **1 — MCP Connectivity Layer**
    - [ X] 1.1 Define MCP types
        - [ ] Create backend/src/types/mcp.ts interfaces
        - [ ] Add npm script `typecheck`
    - [ X] 1.2 WebSocket wrapper
        - [ ] Install `ws` library
        - [ ] Implement McpSocket class skeleton
        - [ ] Add heartbeat ping every 15 s
        - [ ] Write reconnect w/ exponential backoff
    - [ ] 1.3 toolCall helper
        - [ ] Implement generic toolCall<T>()
        - [ ] Write Jest unit tests for toolCall
    - [ ] 1.4 Mock MCP server
        - [ ] Create backend/test/mockServer.ts
        - [ ] Wire mock server into Jest setup

- [ ] **2 — Instruction Parser**
    - [ ] 2.1 Prompt templates
        - [ ] Draft system prompt
        - [ ] Add few‑shot examples
        - [ ] Commit prompts.ts
    - [ ] 2.2 Streaming completion
        - [ ] Integrate OpenAI SDK streaming
        - [ ] Assemble JSON tool call list
    - [ ] 2.3 Heuristic fallbacks
        - [ ] Implement regex quick‑win parser
        - [ ] Merge fallback with LLM output
    - [ ] 2.4 Parser unit tests
        - [ ] Test max‑10 step limit
        - [ ] Test unsupported verbs
        - [ ] Test partial parse behavior

- [ ] **3 — Step Orchestrator**
    - [ ] 3.1 FSM skeleton
        - [ ] Define states IDLE, REVIEW, WAIT_CONFIRM, EXECUTE, ERROR
        - [ ] Implement state transitions
    - [ ] 3.2 Timeouts & retries
        - [ ] Add confirmation 2‑min timeout
        - [ ] Implement retry logic (2 retries)
    - [ ] 3.3 Event routing
        - [ ] Listen to MCP RESULT/ERROR events
        - [ ] Emit status updates to UI

- [ ] **4 — Control UI**
    - [ ] 4.1 Scaffold UI project
        - [ ] Create Vite React + Tailwind boilerplate
        - [ ] Set up routing and basic layout
    - [ ] 4.2 NL input form
        - [ ] Add textarea & Parse button
        - [ ] Wire to backend parse endpoint
    - [ ] 4.3 Step Review modal
        - [ ] Implement Dialog component
        - [ ] Provide Accept / Reject actions
    - [ ] 4.4 Status HUD
        - [ ] Show session state (idle, executing, error)
        - [ ] Display current step number
    - [ ] 4.5 Stop Session handling
        - [ ] Add Stop button
        - [ ] Handle websocket disconnect cleanup

- [ ] **5 — Browser Overlay**
    - [ ] 5.1 Overlay snippet
        - [ ] Write highlight/scroll JS
        - [ ] Inject snippet via MCP `evaluate`
    - [ ] 5.2 Target highlighting
        - [ ] Highlight element before click
        - [ ] Scroll element into view
    - [ ] 5.3 Cleanup
        - [ ] Remove overlay on success or error

- [ ] **6 — E2E Pipeline**
    - [ ] 6.1 Basic E2E test
        - [ ] Write Playwright test (example.com flow)
    - [ ] 6.2 Docker‑Compose env
        - [ ] Create compose file for backend/ui/MCP
        - [ ] Document dev‑up script
    - [ ] 6.3 CI E2E job
        - [ ] Add GitHub Actions step to run compose
        - [ ] Execute Playwright tests headless

- [ ] **7 — Packaging & Docs**
    - [ ] 7.1 Dockerfiles
        - [ ] Author multi‑stage Dockerfile
        - [ ] Build & push GHCR image
    - [ ] 7.2 Release workflow
        - [ ] Create version tagging script
        - [ ] Publish :latest and :<tag> images
    - [ ] 7.3 Documentation
        - [ ] Write README with architecture diagram
        - [ ] Add quick‑start & contribution guide
