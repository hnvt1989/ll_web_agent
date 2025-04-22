# Project Specification (v2): Natural‑Language‑Driven Web Automation Tool with MCP Integration

## 1. Overview
This application lets a user describe a web‑browsing task in plain English (e.g., “Go to YouTube and search for funny cat videos”).  
The backend parses the request into **≤ 10 sequential steps**, confirms each step with the user, and executes them in a visible browser window.  
**Version 2 replaces the custom Playwright driver with a Model Context Protocol (MCP) implementation—Playwright‑MCP—so every browser action is now an MCP tool call.**

---

## 2. Functional Requirements (unchanged)

### 2.1 Input
* Users enter one natural‑language instruction at a time (max 10 steps).

### 2.2 Parsing
* The system converts the instruction into an ordered step list.
* If the sentence cannot be fully parsed, a **partial sequence** is generated.

### 2.3 Execution Flow
1. Show a read‑only summary of all parsed steps.  
2. Ask the user to **confirm each step** before execution.  
3. Abort immediately on any rejection or critical error.  
4. Execute each confirmed step in a **visible browser** managed by Playwright‑MCP.

### 2.4 Supported Browser Actions (Initial Set)
| Action | MCP Tool | Notes |
|--------|----------|-------|
| Navigate to URL | `navigate` | Absolute or relative URL |
| Perform a search | `search` | Requires selector & query |
| Click element | `click` | Target via selector |
| Type into field | `type` | Password masking supported |
| Scroll | `scroll` | Direction + offset |
| Validate text | `assert_text` | Exact match |
| Auto‑dismiss pop‑ups | `dismiss_modal` | Built‑in heuristic |

### 2.5 UI Behavior
* Control UI (React) is separate from the browser window.  
* Shows confirmation modal, visual overlays, status indicators, and a manual **“Stop Session”** button.

---

## 3. **System Architecture (MCP)**

```
┌──────────┐  NL instruction ┌────────────────────────┐
│ Control  │ ───────────────▶│  Backend Service       │
│   UI     │                 │  ├─ Parser & Validator │
└──────────┘                 │  ├─ Step Orchestrator  │
        ▲  Status / Snapshots│  └─ MCP Client (WS)    │
        │                    └──────────┬─────────────┘
        ╰────────────────────────────────┘
                              (WebSocket MCP)
                         ┌────────────────────────┐
                         │  Playwright‑MCP Server │
                         │  (isolated Chromium)   │
                         └─────────┬──────────────┘
                                   │
                              Real Browser
```

### 3.1 Backend Service Responsibilities
| Module | Purpose |
|--------|---------|
| **Parser** | Convert NL → list of MCP `tool_call` objects |
| **Step Orchestrator** | Manage confirmation, retries, and timeouts |
| **MCP Client** | Maintain persistent WS to Playwright‑MCP; stream events back to UI |

### 3.2 Deployment
1. **Start MCP server**  
   ```bash
   npx playwright-mcp start --port 9000
   ```
2. **Run backend**  
   ```bash
   export MCP_SERVER_WS=ws://localhost:9000
   pnpm backend:start
   ```

---

## 4. Error Handling Strategy (updated)

| Scenario | Handling |
|----------|----------|
| Element not found | Playwright‑MCP returns `ELEMENT_NOT_FOUND`; backend retries twice, then halts |
| Ambiguous command | Backend sends best‑guess `tool_call`; user confirmation required |
| Tool‑call timeout | MCP returns `TIMEOUT`; counted as a retry |
| User inactivity | 2‑minute confirmation window → backend sends `CANCEL_SESSION` |
| UI closed mid‑session | Backend closes MCP WS; server terminates browser |

---

## 5. Data & Session Handling (unchanged)
* Stateless design—no DB, logs, or authentication.

---

## 6. Scope Limitations (unchanged)
* No file transfer, multi‑tab, or mobile support in v2.

---

## 7. Testing Plan

### 7.1 Unit Tests
* Validate MCP `tool_call` schema construction.

### 7.2 Integration Tests
* Mock Playwright‑MCP with the official test harness.

### 7.3 End‑to‑End Tests
* Spin up real Playwright‑MCP in Docker; run full NL → execution flow.

### 7.4 UI/UX Tests
* Overlay accuracy, status indicators, session timeout notifications.

---

## 8. Future Considerations
* Authenticated MCP handshake (once spec finalizes).
* Additional languages, conditional logic, file transfer tools.
* Live page streaming via prospective `stream_page` tool.

---
