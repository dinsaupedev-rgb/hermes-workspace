import { z } from 'zod';

export const TaskStatus = z.enum(['pending', 'running', 'blocked', 'review', 'completed', 'failed']);
export type TaskStatus = z.infer<typeof TaskStatus>;

export const TaskPriority = z.enum(['critical', 'high', 'medium', 'low']);

export const TaskSchema = z.object({
  task_id: z.string(),
  title: z.string(),
  description: z.string(),
  owner: z.string(),
  dependencies: z.array(z.string()).default([]),
  status: TaskStatus as unknown as z.ZodType<TaskStatus>,
  priority: TaskPriority as unknown as z.ZodType<z.infer<typeof TaskPriority>>,
  acceptance_criteria: z.array(z.string()).default([]),
  artifacts: z.array(z.string()).default([]),
  attempts: z.number().int().min(0).default(0),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Task = z.infer<typeof TaskSchema>;

export const ArtifactSchema = z.object({
  key: z.string(),
  project_id: z.string(),
  task_id: z.string().nullable(),
  agent: z.string(),
  mime: z.string(),
  path: z.string(),
  created_at: z.string(),
});
export type Artifact = z.infer<typeof ArtifactSchema>;

export const EventSchema = z.object({
  event_id: z.string(),
  timestamp: z.string(),
  project_id: z.string(),
  agent: z.string(),
  task_id: z.string().nullable(),
  event_type: z.string(),
  input: z.unknown().optional(),
  output: z.unknown().optional(),
  model: z.string().nullable().optional(),
  latency_ms: z.number().nullable().optional(),
  tokens: z.number().nullable().optional(),
  cost: z.number().nullable().optional(),
  status: z.string(),
});
export type AgentEvent = z.infer<typeof EventSchema>;

export const MessageSchema = z.object({
  message_id: z.string(),
  project_id: z.string(),
  from_agent: z.string(),
  to_agent: z.string(),
  task_id: z.string().nullable(),
  message_type: z.enum(['request', 'response', 'review', 'approval', 'failure']),
  objective: z.string(),
  context: z.record(z.unknown()).optional(),
  artifacts: z.array(z.string()).default([]),
  status: z.string(),
  priority: z.string(),
  requires_approval: z.boolean().default(false),
  timestamp: z.string(),
});
export type AgentMessage = z.infer<typeof MessageSchema>;

export const ApprovalSchema = z.object({
  approval_id: z.string(),
  project_id: z.string(),
  task_id: z.string().nullable(),
  checkpoint: z.string(),
  request_reason: z.string(),
  requested_by: z.string(),
  artifacts: z.array(z.string()).default([]),
  status: z.enum(['pending', 'approved', 'rejected']),
  decided_by: z.string().nullable().optional(),
  decision_note: z.string().nullable().optional(),
  created_at: z.string(),
  decided_at: z.string().nullable().optional(),
});
export type Approval = z.infer<typeof ApprovalSchema>;

export const ProjectStateSchema = z.object({
  project_id: z.string(),
  name: z.string(),
  idea: z.string(),
  created_at: z.string(),
  phase: z.enum(['analysis', 'requirements', 'architecture', 'implementation', 'qa', 'security', 'deployment', 'completed']),
  status: z.enum(['running', 'waiting_approval', 'completed', 'failed', 'paused']),
  requirements: z.unknown().nullable().optional(),
  stories: z.unknown().nullable().optional(),
  architecture: z.unknown().nullable().optional(),
  repo_path: z.string().nullable().optional(),
});

export const AgentRole = z.enum([
  'orchestrator',
  'product-manager',
  'architect',
  'engineer',
  'qa',
  'devops',
  'security',
]);
export type AgentRole = z.infer<typeof AgentRole>;

export const AgentDefSchema = z.object({
  name: z.string(),
  role: AgentRole as unknown as z.ZodType<AgentRole>,
  description: z.string(),
  systemPrompt: z.string(),
  tools: z.array(z.string()),
  kind: z.enum(['default', 'cheap', 'high-reasoning', 'coding', 'evaluation']),
  maxIterations: z.number().int().positive().default(5),
  approvalGates: z.array(z.string()).default([]),
});
export type AgentDef = z.infer<typeof AgentDefSchema>;

export const POLICY_TOOL_SCOPES: Record<string, readonly string[]> = {
  'product-manager': ['project_memory.read', 'project_memory.write', 'artifact.write'],
  architect: ['project_memory.read', 'project_memory.write', 'artifact.write'],
  engineer: ['repo.read', 'repo.write', 'exec.test', 'retrieval.read', 'artifact.write'],
  qa: ['repo.read', 'exec.test', 'artifact.write'],
  security: ['repo.read', 'security.scan', 'policy.enforce'],
  devops: ['infra.read', 'infra.deploy', 'infra.rollback'],
  orchestrator: ['project_memory.read', 'project_memory.write', 'agent.delegate'],
};

export const AGENTS: readonly AgentDef[] = [
  {
    name: 'product-manager',
    role: 'product-manager',
    description: 'Turns raw ideas into structured requirements and prioritized user stories.',
    systemPrompt: `You are the Product Manager agent of an autonomous software team.\nYour task is to analyze a product idea and produce strict JSON on the LAST line of your response.\nThe JSON must be exactly: {"problem": "...", "target_users": ["..."], "business_goal": "...", "functional_requirements": [{"id": "FR1", "text": "...", "priority": "must|should|could", "testable": true}], "non_functional_requirements": [{"id": "NFR1", "text": "...", "category": "performance|security|usability|reliability", "testable": true}], "unknowns": ["..."], "stories": [{"id": "S1", "as": "...", "want": "...", "so_that": "...", "acceptance_criteria": ["..."]}], "assumptions": ["..."], "risks": [{"risk": "...", "mitigation": "..."}]}\nRules: If any part of the idea is ambiguous, list it in "unknowns". Never silently invent requirements. Functional requirements must have ids FR1, FR2... Stories S1, S2... Every story needs at least one acceptance criterion.`,
    tools: ['project_memory.read', 'project_memory.write', 'artifact.write'],
    kind: 'high-reasoning',
    maxIterations: 5,
    approvalGates: [],
  },
  {
    name: 'architect',
    role: 'architect',
    description: 'Produces architecture, stack choice, and integration design from requirements.',
    systemPrompt: `You are the Solution Architect agent. Given the requirements JSON and codebase analysis, produce strict JSON on the LAST line of your response:\n{"app_name": "...", "stack": {"language": "...", "runtime": "...", "framework": "...", "data_layer": "..."}, "components": [{"name": "...", "responsibility": "...", "depends_on": []}], "data_model": [{"name": "...", "fields": [{"name": "...", "type": "string|number|boolean|timestamp", "notes": "..."}]}], "api_endpoints": [{"method": "GET|POST|PUT|DELETE", "path": "/api/...", "purpose": "..."}], "decisions": [{"decision": "...", "reason": "...", "alternatives": ["..."], "tradeoffs": "..."}], "risks": ["..."], "notes": "..."}\nRules: Choose boring, proven technology suited to the requirements. Justify each decision in "decisions". Keep the component count small (max 6). The app must be runnable as a static/CLI demo: no real cloud services needed.`,
    tools: ['project_memory.read', 'project_memory.write', 'artifact.write'],
    kind: 'high-reasoning',
    maxIterations: 5,
    approvalGates: [],
  },
  {
    name: 'engineer',
    role: 'engineer',
    description: 'Implements the architecture: source files, tests, and docs in the project repo.',
    systemPrompt: `You are the Software Engineer agent. Given the architecture JSON, emit implementation files.\nRespond with ONE strict JSON object on the LAST line:\n{"files": [{"path": "src/index.js", "content": "...file content...", "purpose": "..."}], "tests": [{"path": "tests/test_api.js", "content": "...", "purpose": "..."}], "summary": "..."}\nRules:\n- Implement a small but complete Node.js app with no external runtime dependencies other than 'node:test' built-in test runner and 'node:http'/'node:fs'.\n- Include at least 3 meaningful test cases under tests/ using node:test and node:assert.\n- Demonstrate the brief in app logic, not just hello-world.\n- No comments starting with 'TODO'. No halting earlier files for missing ones.`,
    tools: ['repo.read', 'repo.write', 'exec.test', 'artifact.write'],
    kind: 'coding',
    maxIterations: 5,
    approvalGates: [],
  },
  {
    name: 'qa',
    role: 'qa',
    description: 'Generates and runs tests, enforces quality gates.',
    systemPrompt: `You are the QA Agent. Given the app source summary and test results summary, identify additional risk that existing tests may not cover.\nRespond with ONE strict JSON object on the LAST line:\n{"coverage_gaps": [{"gap": "...", "why_it_matters": "..."}], "suggested_extra_tests": [{"path": "tests/extra.test.js", "content": "...", "asserts": "..."}], "overall_pass": true}\nRules: Only suggest tests that use node:test and node:assert with no new dependencies. overall_pass is true only if no critical coverage gap affects acceptance criteria.`,
    tools: ['repo.read', 'exec.test', 'artifact.write'],
    kind: 'evaluation',
    maxIterations: 3,
    approvalGates: [],
  },
  {
    name: 'security',
    role: 'security',
    description: 'Independent security review of source, dependencies, and tool usage.',
    systemPrompt: `You are the Security & Governance agent. Review the app source summary for OWASP Top 10 risks, secret leakage, injection, XSS, SSRF, tool abuse, excessive agency, and data exposure.\nRespond with ONE strict JSON object on the LAST line:\n{"findings": [{"id": "SEC-1", "severity": "low|medium|high|critical", "category": "...", "title": "...", "evidence": "...", "remediation": "..."}], "blocking": true|false, "summary": "..."}\nRules: Be specific — cite file/function names. blocking=true only when a HIGH or CRITICAL finding requires code change before ship. Never silently ignore secrets, eval(), or shell拼接 risks.`,
    tools: ['repo.read', 'security.scan', 'policy.enforce'],
    kind: 'evaluation',
    maxIterations: 3,
    approvalGates: [],
  },
  {
    name: 'devops',
    role: 'devops',
    description: 'Builds deployment plan, health checks, and rollback strategy.',
    systemPrompt: `You are the DevOps/LLMOps agent. Given the app summary, produce a deployment plan.\nRespond with ONE strict JSON object on the LAST line:\n{"environment": "staging|production", "build_steps": ["npm install", "..."], "smoke_tests": ["curl http://localhost:3000/api/health"], "rollback_strategy": "...", "monitoring": [{"metric": "...", "threshold": "..."}], "cost_guardrails": [...], "requires_approval": true}\nRules: This is a demo — no real cloud. requires_approval must be true for production.`,
    tools: ['infra.read', 'infra.deploy', 'infra.rollback', 'artifact.write'],
    kind: 'default',
    maxIterations: 3,
    approvalGates: ['production_deployment'],
  },
];
