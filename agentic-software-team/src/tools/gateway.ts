import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { AgentDef, POLICY_TOOL_SCOPES } from '../agents/definitions.js';
import { sanitizeToolArgs } from '../core/runtime.js';

export type ToolName =
  | 'project_memory.read'
  | 'project_memory.write'
  | 'repo.read'
  | 'repo.write'
  | 'exec.test'
  | 'security.scan'
  | 'policy.enforce'
  | 'infra.deploy'
  | 'infra.rollback'
  | 'infra.read'
  | 'agent.delegate'
  | 'artifact.write'
  | 'retrieval.read';

export interface ToolContext {
  projectId: string;
  taskId: string | null;
  agent: string;
  repoPath: string;
  store: { logEvent(e: unknown): void } | null;
}

export interface ToolResult {
  ok: boolean;
  output: string;
  data?: unknown;
}

export class ToolGateway {
  constructor(private ctx: ToolContext) {}

  /** Enforce least privilege: agent must have the tool in its role scope. */
  private assertAllowed(def: AgentDef, tool: ToolName) {
    const scopes = POLICY_TOOL_SCOPES[def.role] ?? [];
    if (!scopes.includes(tool)) {
      throw new Error(`tool '${tool}' not permitted for agent '${def.name}' (role=${def.role})`);
    }
  }

  async execute(def: AgentDef, tool: ToolName, args: unknown): Promise<ToolResult> {
    this.assertAllowed(def, tool);
    const a = sanitizeToolArgs(args) as Record<string, unknown>;
    switch (tool) {
      case 'project_memory.read':
        return this.readArtifact(a);
      case 'project_memory.write':
      case 'artifact.write':
        return this.writeArtifact(a);
      case 'repo.read':
        return this.readRepoFile(a);
      case 'repo.write':
        return this.writeRepoFile(a);
      case 'exec.test':
        return { ok: true, output: 'exec.test is invoked by the QA pipeline directly (sandboxed), not via the model.' };
      case 'security.scan':
        return this.securityScan(a);
      case 'policy.enforce':
        return { ok: true, output: 'policy check ok (specialist policies applied in orchestrator)', data: { scopes: POLICY_TOOL_SCOPES[def.role] } };
      case 'infra.read':
      case 'infra.deploy':
      case 'infra.rollback':
        return { ok: true, output: `${tool} is gated behind human approval for this deployment target.`, data: { requires_approval: true } };
      case 'retrieval.read':
        return { ok: true, output: 'retrieval sandbox is not enabled in MVP.' };
      case 'agent.delegate':
        return { ok: false, output: 'delegate is orchestrator-only.' };
      default:
        throw new Error(`unknown tool ${tool}`);
    }
  }

  private readArtifact(a: Record<string, unknown>) {
    const key = String(a.key ?? '');
    return { ok: true, output: key, data: { key } };
  }

  private writeArtifact(a: Record<string, unknown>): ToolResult {
    const key = String(a.key ?? a.path ?? 'unnamed');
    const content = String(a.content ?? '');
    const dir = join('projects', this.ctx.projectId, 'artifacts');
    mkdirSync(dir, { recursive: true });
    const path = join(dir, key.replace(/[^a-zA-Z0-9._-]/g, '_'));
    writeFileSync(path, content, 'utf8');
    return { ok: true, output: `artifact saved: ${path}`, data: { key: path } };
  }

  private readRepoFile(a: Record<string, unknown>): ToolResult {
    const rel = String(a.path ?? '');
    if (!rel || rel.includes('..')) return { ok: false, output: 'invalid path' };
    const p = join(this.ctx.repoPath, rel);
    if (!existsSync(p)) return { ok: false, output: `file not found: ${rel}` };
    return { ok: true, output: readFileSync(p, 'utf8').slice(0, 8000) };
  }

  private writeRepoFile(a: Record<string, unknown>): ToolResult {
    const rel = String(a.path ?? '');
    if (!rel || rel.includes('..') || rel.startsWith('/')) {
      return { ok: false, output: 'invalid path' };
    }
    const p = join(this.ctx.repoPath, rel);
    mkdirSync(join(p, '..'), { recursive: true });
    writeFileSync(p, String(a.content ?? ''), 'utf8');
    return { ok: true, output: `wrote ${rel}` };
  }

  private securityScan(_a: Record<string, unknown>): ToolResult {
    // MVP heuristic scan — the security agent calls this with repo files list.
    const findings: Array<{ severity: string; file: string; issue: string }> = [];
    const repo = this.ctx.repoPath;
    const scanDirs = ['src', 'tests', 'app', 'lib'];
    for (const dir of scanDirs) {
      const dp = join(repo, dir);
      if (!existsSync(dp)) continue;
      scanJsLike(dp, (file, content) => {
        if (/eval\s*\(/.test(content)) findings.push({ severity: 'high', file, issue: 'eval() usage' });
        if (/(password|secret|api_?key)\s*=\s*['"][^'"]{8,}['"]/i.test(content))
          findings.push({ severity: 'high', file, issue: 'hardcoded secret' });
        if (/child_process|spawn\s*\(|exec\s*\(/.test(content))
          findings.push({ severity: 'medium', file, issue: 'shell execution usage' });
        if (/innerHTML\s*=/.test(content)) findings.push({ severity: 'medium', file, issue: 'innerHTML assignment (XSS)' });
      });
    }
    return {
      ok: true,
      output: `${findings.length} heuristic findings`,
      data: { findings },
    };
  }
}

function scanJsLike(dir: string, cb: (file: string, content: string) => void) {
  for (const entry of require('node:fs').readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) scanJsLike(full, cb);
    else if (/\.(js|ts|mjs|cjs|jsx|tsx)$/.test(entry.name)) cb(full, readFileSync(full, 'utf8').slice(0, 100_000));
  }
}
