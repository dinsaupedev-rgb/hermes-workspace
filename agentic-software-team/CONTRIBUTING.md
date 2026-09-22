# CONTRIBUTING

- Node ≥ 22 required (`node:sqlite`).
- `npm test` before any PR; `npm run typecheck` must be clean.
- Agent prompts are versioned in git (src/agents/definitions.ts) — changes to prompts must include example output in the PR.
- Keep the tool gateway strict: new tools need a scope entry and a deny-by-default rationale.
- Generated apps live under projects/ — do not commit their contents.
- Every quality gate or failure-handling change needs a test in tests/core.test.ts.
