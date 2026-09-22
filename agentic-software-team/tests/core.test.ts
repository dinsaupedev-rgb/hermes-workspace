import { describe, it, expect } from 'vitest';
import { extractJson, sanitizeToolArgs, newId } from './src/core/runtime.ts';
import { RecordStore } from './src/store/store.ts';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('extractJson', () => {
  it('extracts last balanced JSON object from prose', () => {
    const out = extractJson<{ a: number }>('Here is the plan:\nSure! ```json\n{"a": 1}\n```\nDone.', () => ({ a: 0 }));
    expect(out.a).toBe(1);
  });
  it('extracts nested JSON with braces in strings', () => {
    const out = extractJson<{ s: string }>('x {"s": "has \\"nested {brace}\\" inside"}', () => ({ s: '' }));
    expect(out.s).toContain('nested');
  });
  it('returns fallback when no JSON', () => {
    const out = extractJson('no braces here', (e) => ({ msg: e.message }));
    expect((out as { msg: string }).msg).toBeTruthy();
  });
});

describe('sanitizeToolArgs', () => {
  it('drops functions and trims long strings', () => {
    const out = sanitizeToolArgs({ s: 'x'.repeat(5000), n: 5, b: true, bad: () => 'no' });
    expect((out.s as string).length).toBe(4000);
    expect(out.n).toBe(5);
    expect('bad' in out).toBe(false);
  });
});

describe('newId', () => {
  it('prefixes ids', () => {
    expect(newId('x').startsWith('x_')).toBe(true);
  });
});

describe('RecordStore', () => {
  const dir = mkdtempSync(join(tmpdir(), 'asteam-'));
  const store = new RecordStore(join(dir, 'test.db'));
  const pid = newId('proj');

  it('project lifecycle', () => {
    store.createProject({ project_id: pid, name: 't', idea: 'i' });
    expect(store.getProject(pid)?.phase).toBe('analysis');
    store.updateProject(pid, 'qa', 'running');
    expect(store.getProject(pid)?.phase).toBe('qa');
    store.addApprovedCheckpoint(pid, 'requirements');
    expect(JSON.parse(store.getProject(pid)!.approved_checkpoints)).toContain('requirements');
  });

  it('task lifecycle and metrics', () => {
    const tid = newId('task');
    store.createTask({
      task_id: tid,
      project_id: pid,
      title: 'build',
      description: '',
      owner: 'engineer',
      dependencies: [],
      priority: 'high',
      acceptance_criteria: ['works'],
    });
    expect(store.getTask(tid)?.status).toBe('pending');
    store.incrementAttempts(tid);
    expect(store.getTask(tid)?.attempts).toBe(1);
    store.updateTaskStatus(tid, 'completed');
    expect(store.getTask(tid)?.status).toBe('completed');
    store.addTaskArtifact(tid, 'art.json');
    expect(JSON.parse(store.getTask(tid)!.artifacts)).toContain('art.json');
    const m = store.projectMetrics(pid);
    expect(m.tasks_total).toBe(1);
    expect(m.tasks_by_status['completed']).toBe(1);
  });

  it('messages, artifacts, approvals', () => {
    store.logMessage({ project_id: pid, from_agent: 'a', to_agent: 'b', task_id: null, message_type: 'request', objective: 'o', status: 'sent', priority: 'low', requires_approval: false });
    expect(store.listMessages(pid).length).toBeGreaterThan(0);
    store.saveArtifact({ key: 'requirements.json', project_id: pid, task_id: null, agent: 'pm', mime: 'application/json', path: 'x' });
    expect(store.getArtifact(pid, 'requirements.json')?.agent).toBe('pm');
    const aid = store.createApproval({ project_id: pid, task_id: null, checkpoint: 'deployment', request_reason: 'prod', requested_by: 'devops', artifacts: [] });
    expect(store.pendingApprovals(pid).length).toBe(1);
    store.decideApproval(aid, 'approved', 'human', 'ok');
    expect(store.getApproval(aid)?.status).toBe('approved');
  });

  it('events', () => {
    store.logEvent({ project_id: pid, agent: 'test', event_type: 'x', status: 'ok' });
    expect(store.listEvents(pid).length).toBeGreaterThan(0);
  });
});
