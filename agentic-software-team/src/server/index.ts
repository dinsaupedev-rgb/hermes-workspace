import express from 'express';
import { join, dirname } from 'node:path';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { RecordStore } from '../store/store.js';
import { Orchestrator, DEFAULT_ORCH_CONFIG } from '../core/orchestrator.js';
import { makeGateway } from '../config/env.js';
import { newId } from '../core/runtime.js';

const DATA_DIR = join(process.cwd(), 'data');
mkdirSync(DATA_DIR, { recursive: true });
const store = new RecordStore(join(DATA_DIR, 'asteam.db'));

const app = express();
app.use(express.json({ limit: '2mb' }));

// CORS for the dashboard (dev convenience)
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
});

// ---- projects ----
app.get('/api/projects', (_req, res) => {
  res.json(store.listProjects().map((p) => ({ ...p, metrics: store.projectMetrics(p.project_id) })));
});

app.post('/api/projects', async (req, res) => {
  const { name, idea, auto = true } = req.body ?? {};
  if (!name || !idea) {
    res.status(400).json({ error: 'name and idea are required' });
    return;
  }
  const projectId = newId('proj_' + name.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase().slice(0, 20));
  try {
    store.createProject({ project_id: projectId, name, idea });
  } catch (e) {
    res.status(400).json({ error: `could not create project: ${(e as Error).message}` });
    return;
  }
  if (auto) {
    // Kick off orchestration in the background; poll /api/projects/:id for state.
    const orchestrator = new Orchestrator(makeGateway(), store, {
      ...DEFAULT_ORCH_CONFIG,
      autoApprove: ['requirements', 'architecture', 'code_changes', 'qa', 'security'],
    });
    orchestrator.run(projectId, idea).catch((e) => {
      console.error('orchestrator failed:', e);
      store.updateProject(projectId, 'completed', 'failed');
      store.logEvent({ project_id: projectId, agent: 'orchestrator', task_id: null, event_type: 'orchestrator.failed', status: (e as Error).message.slice(0, 300) });
    });
    res.status(202).json({ project_id: projectId, status: 'running' });
    return;
  }
  res.status(201).json({ project_id: projectId, status: 'created' });
});

app.get('/api/projects/:id', (req, res) => {
  const p = store.getProject(req.params.id);
  if (!p) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  res.json({ ...p, metrics: store.projectMetrics(p.project_id), tasks: store.listTasks(p.project_id), approvals: store.listApprovals(p.project_id) });
});

app.get('/api/projects/:id/events', (req, res) => {
  res.json(store.listEvents(req.params.id, 200));
});

app.get('/api/projects/:id/artifacts', (req, res) => {
  res.json(store.listArtifacts(req.params.id));
});

app.get('/api/projects/:id/artifacts/:key', (req, res) => {
  const a = store.getArtifact(req.params.id, req.params.key);
  if (!a) {
    res.status(404).json({ error: 'artifact not found' });
    return;
  }
  res.type('application/json').send(existsSync(a.path) ? readFileSync(a.path, 'utf8') : '{}');
});

app.get('/api/projects/:id/messages', (req, res) => {
  res.json(store.listMessages(req.params.id));
});

// ---- approvals ----
app.get('/api/approvals', (req, res) => {
  res.json(store.pendingApprovals((req.query.project_id as string) ?? ''));
});

app.post('/api/approvals/:id/decide', (req, res) => {
  const { decision = 'approved', note = '' } = req.body ?? {};
  const a = store.getApproval(req.params.id);
  if (!a) {
    res.status(404).json({ error: 'approval not found' });
    return;
  }
  store.decideApproval(req.params.id, decision === 'rejected' ? 'rejected' : 'approved', 'human', String(note));
  store.addApprovedCheckpoint(a.project_id, a.checkpoint);
  store.updateProject(a.project_id, a.project_id ? (store.getProject(a.project_id)?.phase ?? 'analysis') : 'analysis', 'running');
  res.json({ ok: true, decision });
});

// ---- health ----
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

// ---- dashboard ----
app.get('/', (_req, res) => {
  res.type('html').send(readFileSync(join(process.cwd(), 'src', 'server', 'dashboard.html'), 'utf8'));
});

const PORT = Number(process.env.PORT ?? 4477);
app.listen(PORT, () => {
  console.log(`Agentic Software Team API on http://localhost:${PORT}`);
});
