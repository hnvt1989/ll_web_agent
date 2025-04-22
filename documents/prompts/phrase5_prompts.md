# Phrase5 Prompts

## Prompt 5.1 — Overlay Snippet
```text
Write JS/CSS snippet injected via Playwright `page.addScriptTag` that highlights a DOM element and scrolls it into view.
Return the snippet string constant in `backend/src/overlay/snippet.ts`.
```

## Prompt 5.2 — Target Highlighting
```text
Enhance the overlay snippet to add an `animate-pulse` ring around the target element for 1 s before the click action.
Return the updated `snippet.ts` file.
```

## Prompt 5.3 — Overlay Cleanup
```text
Add `removeOverlay()` function to the snippet and invoke it on SUCCESS or ERROR events.
Return the updated snippet file.
```
