# Phrase2 Prompts

## Prompt 2.1 — Parser Prompt Template
```text
Create prompt templates in `backend/src/parser/prompts.ts`.
• System prompt: "You are a parsing engine..." (see spec).
• Few‑shot examples mapping NL → JSON tool calls.
Return the file.
```

## Prompt 2.2 — Streaming Completion
```text
Implement `parseInstruction()` that streams OpenAI responses in function‑call mode and assembles a list of JSON tool calls.
Return the new file `backend/src/parser/parseInstruction.ts`.
```

## Prompt 2.3 — Heuristic Fallback Parser
```text
Add `fallbackParser()` in `backend/src/parser/fallback.ts` using regex to detect simple commands (go to, click, type).
Return the file.
```

## Prompt 2.4 — Parser Unit Tests
```text
Write Jest tests in `backend/test/parser.spec.ts` covering:
• Max 10‑step limit. • Unsupported verbs. • Partial parse fallback.
Return the full test file.
```
