# Phrase0 Prompts

## Prompt 0.1 — Bootstrap Workspace
```text
You are ChatGPT‑Coder. Task: create a pnpm monorepo with two packages: `backend` and `ui`. Use TypeScript 5, Node 18, and React 18.
• Generate `package.json` at the root with `workspaces` array.
• Scaffold `backend/package.json` and `ui/package.json` with minimal scripts.
• Do not install deps yet.
Return all three JSON files in separate ```json blocks.
```

## Prompt 0.2 — Add TypeScript Configs
```text
Add strict `tsconfig.json` files to root and each package.
Root extends `@tsconfig/strictest/tsconfig.json` and sets `composite: true`.
Backend config targets Node 18; UI targets `dom` libs.
Return three ```json blocks.
```

## Prompt 0.3 — ESLint & Prettier Setup
```text
Create shared ESLint + Prettier config inside `packages/config/eslint/`.
Include TypeScript, React, and Prettier plugins.
Return config files and update npm scripts.
```

## Prompt 0.4 — Husky Pre‑Commit Hook
```text
Set up Husky pre‑commit hook that runs `npm run lint` and `npm test -- --watch=false` on every commit.
• Install Husky and configure Git hooks.
• Update root `package.json` with the script: "prepare": "husky install".
Return updated `package.json` and `.husky/pre-commit` shell script in separate code blocks.
```

## Prompt 0.5 — GitHub Actions CI Workflow
```text
Create GitHub Actions workflow `.github/workflows/ci.yml` that performs:
1. Checkout repo.
2. Setup Node 18 and pnpm.
3. Install dependencies with `pnpm install --frozen-lockfile`.
4. Run `npm run lint`, `npm run typecheck`, and `npm test`.
Return the full YAML file.
```
