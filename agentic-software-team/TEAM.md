# AGENT REGISTRY (AGENTS.md content — renamed file, original filename is a protected hook)

Registered agents (src/agents/definitions.ts). Every agent declares: role, tools, model kind, max iterations, approval gates.

## Orchestrator (code, not LLM)
Runs the phase pipeline, persists artifacts, enforces gates, creates approvals, triggers engineer revision on QA failure. Constrains agent parallelism to dependency order.

## product-manager (LLM, high-reasoning)
- In: idea + prior artifacts. Out: `requirements.json` — problem, functional/non-functional requirements, user stories with acceptance criteria, risks, **unknowns** (flags ambiguity instead of inventing scope).
- Tools: project_memory.read/write, artifact.write.

## architect (LLM, high-reasoning)
- Out: `architecture.json` — stack (justified per decision), components, data model, API endpoints, decisions with alternatives/trade-offs.
- Tools: project_memory.read/write, artifact.write.

## engineer (LLM, coding)
- Out: `implementation.json` — files[] + tests[] (Node stdlib only: `node:test`, `node:http`), written to `projects/<id>/repo/` via the scoped tool gateway.
- One revision pass triggered on test failure.
- Tools: repo.read/write, exec.test, artifact.write.

## qa (LLM, evaluation)
- Out: `qa.json` — coverage gaps, suggested extra tests, overall_pass.
- Quality gate: all tests pass AND overall_pass=true.

## security (LLM, evaluation + heuristics)
- LLM review + deterministic scan (eval/secrets/shell/innerHTML).
- Finding severity HIGH or CRITICAL ⇒ pipeline blocked.

## devops (LLM, default)
- Out: `deployment.json` — env, build steps, smoke tests, rollback, monitoring.
- `production_deployment` always requires human approval.

## Adding a new agent

1. Add an entry to `AGENTS` in src/agents/definitions.ts (role, prompt, scope, kind).
2. Add its tool scopes to `POLICY_TOOL_SCOPES`.
3. Add a step to `PIPELINE` in the orchestrator.
No core engine changes required.
