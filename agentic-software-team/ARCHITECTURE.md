# ARCHITECTURE

## System shape

```
src/
├── core/
│   ├── runtime.ts        # id gen, resilient JSON extraction, tool-arg sanitizer
│   └── orchestrator.ts   # phase pipeline, quality gates, approvals, revision loop
├── agents/
│   ├── definitions.ts    # agent registry: role, prompt, tool scopes, model kind
│   └── executor.ts       # agent state machine + retry/failure handling
├── gateway/
│   ├── registry.ts       # ChatMessage / CallOptions types (model-agnostic)
│   └── model.ts          # ModelGateway: OpenAI-compatible adapter, budget guard
├── tools/
│   ├── gateway.ts        # scoped tool interface (repo/artifact/security/policy)
│   └── test-runner.ts    # sandboxed `node --test` execution of generated repos
├── store/
│   └── store.ts          # SQLite (node:sqlite): projects, tasks, events, artifacts,
│                         # messages, approvals + aggregate metrics
├── config/
│   ├── env.ts            # env loader + gateway factory
│   └── budget.ts         # budget constants
├── server/
│   ├── index.ts          # Express API
│   └── dashboard.html    # single-file dashboard (served at /)
└── cli/
    └── create-project.ts # CLI entry: create + run autonomously
```

## Key design decisions & trade-offs

| Decision | Reason | Alternatives | Trade-off |
|---|---|---|---|
| SQLite via built-in `node:sqlite` | zero native-build deps (Windows), zero install | better-sqlite3, Postgres | single-writer; fine for per-project state |
| Structured JSON artifacts over chat history | agents consume previous phases through compact JSON, replayable | long chat threads | less nuance passed forward; artifacts are inspectable |
| Phase pipeline (not DAG) for MVP | dependencies are inherently sequential for v1 | full DAG scheduler | no parallel phase work yet; DAG schema is in place |
| Model gateway with one route | one OpenAI-compatible URL + session header covers OpenCode Go | multi-provider adapters | per-kind routing wired but single route; add routes in `GatewayConfig` |
| `node --test` for generated repos | generated code has zero net deps by design | vitest in generated repos | CJS/ESM mismatch mitigated by writing a plain package.json + `--test-force-exit` |
| LLM outputs JSON parsed by balanced-brace extraction | resilient to prose/fences, no tool-call reqs | strict JSON mode | occasionally truncated output → revision pass or fail-visible |
| Fixed pipeline steps for shell (`node --test`) | model never supplies commands → no injection surface | model-driven shell | less flexible; safety first |

## Failure handling

- Model call: 3 attempts, retry on 429/5xx/timeouts, backoff; budget-exhausted escalates.
- Agent JSON invalid: retryable; validator may trigger revision.
- Generated repo tests fail: one engineer revision pass with failing output; if still failing, pipeline pauses at `code_changes` approval.
- Security HIGH/CRITICAL findings: block, no retry.
- Non-whitelisted checkpoints: pause and surface an approval.

## Events

All agent/orchestrator actions are single-row inserts to `events` (event_id, timestamp, project_id, agent, event_type, status). The dashboard polls `/api/projects/:id/events` for the live timeline.
