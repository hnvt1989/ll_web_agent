# Natural Language Web Automation Tool

A web automation tool that lets users describe tasks in plain English and executes them in a visible browser window. Powered by the Model Context Protocol (MCP) and large language models from Anthropic or OpenAI.

## Architecture Overview

```
┌──────────┐  NL instruction ┌────────────────────────┐
│ Control  │ ───────────────▶│  Backend Service       │
│   UI     │                 │  ├─ Parser & Validator │
└──────────┘                 │  ├─ Step Orchestrator  │
        ▲  Status / Snapshots│  └─ MCP Client (SSE)    │
        │                    └──────────┬─────────────┘
        ╰────────────────────────────────┘
                              (SSE MCP)
                         ┌────────────────────────┐
                         │  Playwright‑MCP Server │
                         │  (isolated Chromium)   │
                         └─────────┬──────────────┘
                                   │
                              Real Browser
```

### Key Components

1. **UI Layer** (`/ui`): 
   - React-based user interface for instruction input
   - Confirmation modals for verifying steps
   - Status indicators and session control buttons

2. **Backend Service** (`/backend`):
   - **Parser** (`/backend/src/parser`): Converts natural language to a sequence of MCP tool calls using Anthropic Claude or OpenAI
   - **Orchestrator** (`/backend/src/orchestrator`): Manages the FSM, session state, and execution flow
   - **MCP Client** (`/backend/src/mcp`): Handles communication with the MCP server

3. **Playwright-MCP** (external): 
   - Executes browser actions through a standardized Model Context Protocol
   - Maintains isolated browser instance
   - Provides tool execution capabilities

### Data Flow

1. User enters a natural language instruction through the UI
2. Backend parses instruction into sequential steps using LLMs
3. User confirms each step before execution
4. Orchestrator executes steps via MCP server
5. Real browser performs the actions
6. Status and snapshots are sent back to UI

## Setup and Running

### Prerequisites

- Node.js 18 or higher
- Docker and Docker Compose (for containerized deployment)
- API key for either Anthropic Claude or OpenAI (for natural language parsing)

### Local Development

1. **Clone the repository**
   ```bash
   git clone https://github.com/yourusername/ll_web_agent.git
   cd ll_web_agent
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment**
   Create a `.env` file in the root directory:
   ```
   # Choose one of the following API keys based on which LLM you want to use
   ANTHROPIC_API_KEY=your_anthropic_api_key
   OPENAI_API_KEY=your_openai_api_key
   
   MCP_SERVER_URL=http://localhost:9000
   MCP_SERVER_SSE_URL=http://localhost:9000/sse
   ```

4. **Start the MCP server**
   ```bash
   npx @playwright/mcp@latest --port 9000
   ```

5. **Run the backend**
   ```bash
   npm run backend:start
   ```

6. **Run the UI (in a separate terminal)**
   ```bash
   npm run ui:start
   ```

7. **Access the application**
   Open your browser to http://localhost:5173

### Using Docker Compose

1. **Build and start all services**
   ```bash
   docker-compose up -d
   ```

2. **Access the application**
   Open your browser to http://localhost:3000

## Usage Guide

1. **Enter an instruction**
   Type a natural language instruction like "Go to Google, search for 'Playwright MCP', and click the first result."

2. **Review steps**
   The system will break down your instruction into individual steps and present them for confirmation.

3. **Confirm each step**
   Review each step and confirm to proceed with execution.

4. **Watch execution**
   A browser window will open and execute the confirmed steps.

5. **Stop at any time**
   Use the "Stop Session" button to cancel execution.

## Demo

Check out the [demo directory](./demo) for a video demonstration of the tool in action.

## Development Notes

- The system uses a Finite State Machine (FSM) to manage session state
- Error handling includes retries for common failures like elements not found
- MCP communication happens over Server-Sent Events (SSE)
- The UI communicates with the backend through RESTful API calls

## License

## Example LLM command:

go to https://coffee-cart.app/ and click item Expresso then click Cart