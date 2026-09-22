import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ModelGateway, ChatResult } from '../gateway/model.js';
import { RecordStore } from '../store/store.js';
import { AGENTS } from '../agents/definitions.js';
import { AgentExecutor, AgentRunContext, AgentState } from '../agents/executor.js';
import { ToolGateway } from '../tools/gateway.js';
import { runTests, TestRunResult } from '../tools/test-runner.js';
import { newId, extractJson } from '../core/runtime.js';

export interface OrchestratorConfig {
  autoApprove: string[]; // checkpoints to auto-approve in autonomous mode
  maxParallel: number;
  maxIterationsPerTask: number;
}

export const DEFAULT_ORCH_CONFIG: OrchestratorConfig = {
  autoApprove: ['requirements', 'architecture', 'qa', 'security'],
  maxParallel: 3,
  maxIterationsPerTask: 5,
};

export type Phase = 'analysis' | 'requirements' | 'architecture' | 'implementation' | 'qa' | 'security' | 'deployment' | 'completed';

export interface OrchestratorEvent {
  phase: Phase;
  agent: string;
  status: 'started' | 'ok' | 'failed' | 'skipped' | 'approval_required' | 'gate_failed';
  message: string;
  ts: string;
  data?: unknown;
}

const PIPELINE: Array<{ phase: Phase; agent: string; checkpoint: string }> = [
  { phase: 'requirements', agent: 'product-manager', checkpoint: 'requirements' },
  { phase: 'architecture', agent: 'architect', checkpoint: 'architecture' },
  { phase: 'implementation', agent: 'engineer', checkpoint: 'code_changes' },
  { phase: 'qa', agent: 'qa', checkpoint: 'qa' },
  { phase: 'security', agent: 'security', checkpoint: 'security' },
  { phase: 'deployment', agent: 'devops', checkpoint: 'production_deployment' },
];

export class Orchestrator {
  private executor: AgentExecutor;
  private events: OrchestratorEvent[] = [];

  constructor(
    private gateway: ModelGateway,
    private store: RecordStore,
    private cfg: OrchestratorConfig = DEFAULT_ORCH_CONFIG,
  ) {
    this.executor = new AgentExecutor(gateway, store);
  }

  getEvents() {
    return [...this.events, ...this.events].slice(-200);
  }

  async run(projectId: string, idea: string): Promise<{ status: string; phases: OrchestratorEvent[]; testResult?: TestRunResult }> {
    this.currentProjectId = projectId;
    const repoPath = join(process.cwd(), 'projects', projectId, 'repo');
    mkdirSync(repoPath, { recursive: true });
    this.store.updateProject(projectId, 'analysis', 'running');
    this.log('analysis', 'orchestrator', 'started', `project ${projectId} started`, { idea });

    const priorArtifacts: string[] = [];
    let testResult: TestRunResult | null = null;
    let failed = false;

    for (const step of PIPELINE) {
      const def = AGENTS.find((a) => a.name === step.agent);
      if (!def) {
        this.log(step.phase, step.agent, 'skipped', `agent ${step.agent} not registered`);
        continue;
      }
      this.store.updateProject(projectId, step.phase, 'running');
      this.store.logMessage({
        project_id: projectId,
        from_agent: 'orchestrator',
        to_agent: def.name,
        task_id: null,
        message_type: 'request',
        objective: `Execute phase ${step.phase}`,
        status: 'sent',
        priority: 'high',
        requires_approval: false,
      });
      this.log(step.phase, def.name, 'started', `phase ${step.phase} begin`);

      const ctx: AgentRunContext = {
        projectId,
        taskId: null,
        idea,
        promptVars: {},
        workingDir: repoPath,
        previousTasks: priorArtifacts,
      };

      const result = await this.executor.run(def, ctx);
      if (result.state !== 'COMPLETED') {
        this.log(step.phase, def.name, 'failed', `agent returned ${result.state}: ${result.failureReason ?? 'unknown'}`);
        this.store.updateProject(projectId, step.phase, 'failed');
        failed = true;
        break;
      }
      this.store.logMessage({
        project_id: projectId,
        from_agent: def.name,
        to_agent: 'orchestrator',
        task_id: null,
        message_type: 'response',
        objective: `Completed ${step.phase}`,
        status: 'ok',
        priority: 'medium',
        requires_approval: false,
      });

      // persist the structured artifact
      const artifactKey = `${step.phase}.json`;
      const artDir = join('projects', projectId, 'artifacts');
      mkdirSync(artDir, { recursive: true });
      const artifactPath = join(artDir, artifactKey);
      mkdirSync(join(artifactPath, '..'), { recursive: true });
      this.store.saveArtifact({
        key: artifactKey,
        project_id: projectId,
        task_id: null,
        agent: def.name,
        mime: 'application/json',
        path: artifactPath,
      });
      writeFileSync(artifactPath, JSON.stringify(result.json, null, 2), 'utf8');
      priorArtifacts.push(`### ${artifactKey}\n${JSON.stringify(result.json, null, 2).slice(0, 8000)}`);
      this.log(step.phase, def.name, 'ok', `artifact ${artifactKey} saved`);

      // engineer: materialize files into the repo and run tests
      if (def.name === 'engineer') {
        testResult = await this.materializeCode(projectId, repoPath, result.json);
        // Fix-up loop: if the freshly generated app fails its own tests, give the
        // engineer one revision pass with the failing output in context.
        if (testResult && !testResult.ok) {
          this.log('qa', 'orchestrator', 'gate_failed', 'initial build failed tests — requesting engineer revision');
          const fixResult = await this.revisionPass(projectId, idea, repoPath, result.json, priorArtifacts, testResult);
          if (fixResult) {
            priorArtifacts.push(`### implementation.json (revision)\n${JSON.stringify(fixResult, null, 2).slice(0, 8000)}`);
            const revised = await this.materializeCode(projectId, repoPath, fixResult);
            if (revised) testResult = revised;
          }
        }
      }

      // quality gates
      if (def.name === 'qa') {
        const gate = this.qaGate(result.json, testResult);
        if (!gate.pass) {
          this.log(step.phase, def.name, 'gate_failed', gate.reason);
          this.store.updateProject(projectId, step.phase, 'failed');
          failed = true;
          break;
        }
        this.log(step.phase, def.name, 'ok', gate.reason);
      }

      if (def.name === 'security') {
        const findings = (result.json.findings as Array<{ severity: string; title: string }>) ?? [];
        const critical = findings.filter((f) => f.severity === 'critical' || f.severity === 'high');
        if (critical.length > 0) {
          this.log(step.phase, def.name, 'gate_failed', `${critical.length} high/critical security findings block release`);
          this.store.updateProject(projectId, step.phase, 'failed');
          failed = true;
          break;
        }
        this.log(step.phase, def.name, 'ok', `security clean (${findings.length} low/medium)`);
      }

      // checkpoint approval: production_deployment ALWAYS requires human approval
      if (!this.cfg.autoApprove.includes(step.checkpoint)) {
        const approvalId = this.store.createApproval({
          project_id: projectId,
          task_id: null,
          checkpoint: step.checkpoint,
          request_reason: `${step.phase} phase completed; checkpoint ${step.checkpoint} requires human approval`,
          requested_by: def.name,
          artifacts: [artifactKey],
        });
        this.store.updateProject(projectId, step.phase, 'waiting_approval');
        this.log(step.phase, def.name, 'approval_required', `paused at ${step.checkpoint}, approval ${approvalId} requested`);
        this.store.updateProject(projectId, 'completed', 'paused');
        return { status: 'waiting_approval', phases: this.events, testResult: testResult ?? undefined };
      }
      // auto-approved checkpoint
      this.store.addApprovedCheckpoint(projectId, step.checkpoint);
      this.log(step.phase, 'policy', 'ok', `checkpoint ${step.checkpoint} auto-approved by policy`);
    }

    const status = failed ? 'failed' : 'completed';
    this.store.updateProject(projectId, 'completed', status);
    this.log('completed', 'orchestrator', failed ? 'failed' : 'ok', `pipeline ended with status=${status}`);
    return { status, phases: this.events, testResult: testResult ?? undefined };
  }

  /** Take the engineer's JSON and write the declared files into the project repo. */
  private async materializeCode(projectId: string, repoPath: string, json: Record<string, unknown>) {
    const files = (json.files as Array<{ path: string; content: string }>) ?? [];
    const tests = (json.tests as Array<{ path: string; content: string }>) ?? [];
    const gw = new ToolGateway({
      projectId,
      taskId: null,
      agent: 'engineer',
      repoPath,
      store: null,
    });
    const written: string[] = [];
    for (const f of [...files, ...tests]) {
      const r = await gw.execute(
        { name: 'engineer', role: 'engineer', description: '', systemPrompt: '', tools: ['repo.write'], kind: 'coding', maxIterations: 1, approvalGates: [] },
        'repo.write',
        f,
      );
      if (r.ok) written.push(f.path);
      else this.log('implementation', 'engineer', 'failed', `could not write ${f.path}: ${r.output}`);
    }
    this.log('implementation', 'engineer', 'ok', `wrote ${written.length} files`);
    const testRes = runTests(repoPath);
    this.log('qa', 'orchestrator', testRes.ok ? 'ok' : 'gate_failed', `node --test: ${testRes.passed} passed / ${testRes.failed} failed in ${testRes.durationMs}ms`);
    return testRes;
  }

  private qaGate(qaJson: Record<string, unknown>, testRes: TestRunResult | null): { pass: boolean; reason: string } {
    const hardcodedPass = qaJson.overall_pass === true;
    const testsOk = testRes ? testRes.ok && testRes.failed === 0 : false;
    if (!testsOk) return { pass: false, reason: `tests failing (${testRes ? testRes.failed : 0} failed)` };
    if (!hardcodedPass) return { pass: false, reason: 'QA flagged overall_pass=false' };
    return { pass: true, reason: `tests pass (${testRes?.passed}/${testRes?.total}) and QA signed off` };
  }

  /**
   * One engineer revision pass: show failing test output and ask for a corrected
   * file set. Returns the new implementation JSON, or null if the model fails.
   */
  private async revisionPass(
    projectId: string,
    idea: string,
    repoPath: string,
    implementation: Record<string, unknown>,
    priorArtifacts: string[],
    testResult: TestRunResult,
  ): Promise<Record<string, unknown> | null> {
    const def = AGENTS.find((a) => a.name === 'engineer');
    if (!def) return null;
    const failing = testResult.output.slice(0, 4000).split('\n')
      .filter((l) => l.includes('✖') || l.includes('AssertionError') || l.includes('Error') || l.includes('fail'))
      .slice(0, 40)
      .join('\n');
    const fixPrompt = `Project idea:\n${idea}\n\nPrevious agents produced:\n${priorArtifacts.join('\n').slice(0, 12000)}\n\nYour task (engineer — REVISION PASS):\nThe previously generated code failed its own tests in ${testResult.passed}/${testResult.total}. Failing output:\n${failing}\n\nProduce a COMPLETE corrected implementation (all files, same JSON schema: {"files":[...],"tests":[...],"summary":"..."}). Do not output prose.\n`;
    const res = await this.gateway.call(
      [
        { role: 'system', content: def.systemPrompt + '\nThis is a REVISION pass: existing code failed tests. Fix the root cause and return the complete corrected file set.' },
        { role: 'user', content: fixPrompt },
      ],
      { kind: 'coding', maxTokens: 16000, temperature: 0.1, timeoutMs: 280_000 },
      projectId,
      'engineer-revision',
    );
    const json = extractJson(res.content, () => null) as Record<string, unknown> | null;
    if (json && Array.isArray(json.files)) {
      this.log('implementation', 'engineer', 'ok', `revision pass produced ${json.files.length} files`);
      return json;
    }
    this.log('implementation', 'engineer', 'failed', 'revision pass produced no parseable implementation JSON');
    return null;
  }

  private log(phase: Phase, agent: string, status: OrchestratorEvent['status'], message: string, data?: unknown) {
    const ev: OrchestratorEvent = { phase, agent, status, message, ts: new Date().toISOString(), data };
    this.events.push(ev);
    this.store.logEvent({
      project_id: this.currentProjectId ?? 'unknown',
      agent,
      task_id: null,
      event_type: `orchestrator.${status}`,
      status: message.slice(0, 300),
    });
    console.log(`[${ev.ts}] ${phase}/${agent} ${status}: ${message}`);
  }

  private currentProjectId: string | null = null;
}
