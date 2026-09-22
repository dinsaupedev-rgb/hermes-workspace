# Agentic Software Team

A multi-agent software development platform: specialized AI agents (PM → Architect → Engineer → QA → Security → DevOps) collaborate through structured, persisted artifacts to turn an idea into a tested, security-reviewed codebase — with human approval gates.

## How it works

```
Idea ──► Orchestrator
            ├─ product-manager  → requirements.json (stories, acceptance criteria, unknowns)
            ├─ architect        → architecture.json (stack, components, API, decisions)
            ├─ engineer         → implementation.json → writes real repo files
            │                     └─ runs `node --test`; failed builds trigger 1 revision pass
            ├─ qa               → qa.json (coverage gaps) enforces the quality gate
            ├─ security         → security.json; HIGH/CRITICAL findings BLOCK the pipeline
            └─ devops           → deployment.json; production always asks for approval
```

- Every phase output is persisted as an artifact under `projects/<id>/artifacts/*.json`.
- Every agent action is an event in SQLite (`data/asteam.db`); inspect via the dashboard.
- Generated apps live in `projects/<id>/repo/` and are actually executed.
- Checkpoints not in `autoApprove` pause the pipeline and surface an approval job.

## Requirements

- Node.js ≥ 22 (uses the built-in `node:sqlite` module)
- An OpenCode Go API key (`OPENCODE_API_KEY`)

## Install

```bash
npm install
cp .env.example .env    # set OPENCODE_API_KEY
```

## Configure models

All model routes are defined in `src/config/env.ts`. MVP routes all agent "kinds"
(cheap / high-reasoning / coding / evaluation) to one provider route; point
individual kinds at different models by editing `kindRoutes`. Cost/prices are
estimated in `src/gateway/model.ts` (`TOKEN_PRICES_PER_1K`), with a hard budget
guard (`MAX_PROJECT_COST`, default $50) that refuses further model calls when hit.

## Run

### API + Dashboard

```bash
npm run dev          # http://localhost:4477
```

Open the dashboard to create projects, watch the phase flow, inspect artifacts,
the event timeline, and approve or reject checkpoints.

### CLI (fully autonomous run)

```bash
npm run demo         # idea = "Build a web application that tracks personal software projects"
# or:
npx tsx src/cli/create-project.ts --idea "Your idea" --name my-app --auto
```

Exit code 0 = pipeline completed (all gates green). `waiting_approval` = a
non-auto-approved checkpoint paused the run (production deployment always does).

## Test

```bash
npm test             # platform unit tests (vitest)
npm run typecheck    # tsc --noEmit
npx tsx scripts/one-off-test.ts <repo-path>   # run a generated app's tests
```

## Configuration

`.env`:

| Var | Meaning |
|---|---|
| `OPENCODE_BASE_URL` | OpenAI-compatible gateway base URL |
| `OPENCODE_API_KEY` | API key |
| `OPENCODE_MODEL` | default model id |
| `MAX_PROJECT_COST` | USD budget guard |

Approval policy lives in code (`OrchestratorConfig.autoApprove`). Any checkpoint
absent from it pauses the run and waits for a human decision via
`POST /api/approvals/:id/decide`.

## API

| Endpoint | Purpose |
|---|---|
| `GET /api/projects` | list projects + metrics |
| `POST /api/projects` | create + optionally auto-run |
| `GET /api/projects/:id` | status, tasks, approvals |
| `GET /api/projects/:id/events` | event timeline |
| `GET /api/projects/:id/artifacts` | artifact list |
| `GET /api/projects/:id/artifacts/:key` | artifact JSON |
| `GET /api/projects/:id/messages` | agent-to-agent messages |
| `POST /api/approvals/:id/decide` | approve/reject checkpoint |

## Security model

- **Tool scopes:** each agent role has an allowlist (`POLICY_TOOL_SCOPES`); the
  tool gateway rejects out-of-scope calls (e.g. PM cannot write the repo).
- **Repo writes** reject absolute paths and `..` traversal; agent tool args are
  length-capped and fns stripped (`sanitizeToolArgs`).
- **Heuristic scans** on generated code flag `eval()`, hardcoded secrets, shell
  execution, `innerHTML` (see `ToolGateway.securityScan`); the security agent
 _plus_ an LLM review decide to block.
- **No shell access from LLM output** — terminal steps are fixed pipeline steps
  (`node --test`), never model-supplied commands.
- High/critical findings stop the pipeline before QA sign-off.

## Known MVP limitations

- Task graph is a linear phase pipeline; the DAG engine (§12) is stubbed in the
  schema but not yet used for parallel execution.
- Single model route in MVP; routing per task kind is wired but unused.
- QA agent suggests extra tests but they are informational, not auto-run.
- Cost values are estimated from token counts, not provider invoices.
