# Phrase6 Prompts

## Prompt 6.1 — E2E Test
```text
Create Playwright test `e2e/basicFlow.spec.ts` that spins up backend + ui via Docker and validates navigating to example.com.
Return the test file.
```

## Prompt 6.2 — Docker‑Compose Environment
```text
Create `docker-compose.yml` with services: `backend`, `ui`, and `playwright-mcp`, connected via network `automation-net`.
Expose ports 3000 (backend) and 5173 (ui).
Return the docker-compose file.
```

## Prompt 6.3 — CI E2E Job
```text
Add a new `e2e` job in `.github/workflows/ci.yml` that spins up docker-compose, waits for services, and runs Playwright tests headless.
Return the updated workflow YAML.
```
