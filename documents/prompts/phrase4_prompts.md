# Phrase4 Prompts

## Prompt 4.1 — Vite + React Scaffold
```text
Generate a minimal Vite React + Tailwind app in `ui/` with an index page and `App.tsx` showing a single NL input field.
Return created/modified files.
```

## Prompt 4.2 — NL Input Form
```text
Create `ui/src/components/InstructionInput.tsx` with a textarea bound to local `instruction` state and a “Parse” button that POSTs to `/api/parse`.
Return the component file.
```

## Prompt 4.3 — Step Review Modal
```text
Using shadcn/ui Dialog, create `StepReviewModal.tsx` that receives `steps[]` and callbacks `onAccept(stepId)` / `onReject()`.
Return the file.
```

## Prompt 4.4 — Status HUD
```text
Create `ui/src/components/StatusHUD.tsx` showing session state and current step number.
Return the component file.
```

## Prompt 4.5 — Stop Session Handling
```text
Add a red “Stop Session” button in `ui/src/App.tsx` that calls `/api/stop` and disables itself while stopping.
Return the updated `App.tsx` file.
```
