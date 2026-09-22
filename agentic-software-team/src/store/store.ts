import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { newId } from '../core/runtime.js';

export interface ProjectRow {
  project_id: string;
  name: string;
  idea: string;
  phase: string;
  status: string;
  created_at: string;
  approved_checkpoints: string;
}

export interface TaskRow {
  task_id: string;
  project_id: string;
  title: string;
  description: string;
  owner: string;
  dependencies: string;
  status: string;
  priority: string;
  acceptance_criteria: string;
  artifacts: string;
  attempts: number;
  block_reason: string | null;
  created_at: string;
  updated_at: string;
}

export class RecordStore {
  private db: DatabaseSync;

  constructor(readonly path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.migrate();
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS projects(
        project_id TEXT PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        idea TEXT NOT NULL,
        phase TEXT NOT NULL DEFAULT 'analysis',
        status TEXT NOT NULL DEFAULT 'running',
        created_at TEXT NOT NULL,
        approved_checkpoints TEXT NOT NULL DEFAULT '[]'
      );
      CREATE TABLE IF NOT EXISTS tasks(
        task_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        owner TEXT NOT NULL,
        dependencies TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'pending',
        priority TEXT NOT NULL DEFAULT 'medium',
        acceptance_criteria TEXT NOT NULL DEFAULT '[]',
        artifacts TEXT NOT NULL DEFAULT '[]',
        attempts INTEGER NOT NULL DEFAULT 0,
        block_reason TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS events(
        event_id TEXT PRIMARY KEY, timestamp TEXT NOT NULL, project_id TEXT NOT NULL,
        agent TEXT NOT NULL, task_id TEXT, event_type TEXT NOT NULL, status TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS artifacts(
        key TEXT NOT NULL, project_id TEXT NOT NULL, task_id TEXT,
        agent TEXT NOT NULL, mime TEXT NOT NULL, path TEXT NOT NULL, created_at TEXT NOT NULL,
        PRIMARY KEY (project_id, key)
      );
      CREATE TABLE IF NOT EXISTS messages(
        message_id TEXT PRIMARY KEY, project_id TEXT NOT NULL,
        from_agent TEXT NOT NULL, to_agent TEXT NOT NULL, task_id TEXT,
        message_type TEXT NOT NULL, objective TEXT, status TEXT, priority TEXT,
        requires_approval INTEGER NOT NULL DEFAULT 0, timestamp TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS approvals(
        approval_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, task_id TEXT,
        checkpoint TEXT NOT NULL, request_reason TEXT, requested_by TEXT,
        artifacts TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL, decided_at TEXT, decided_by TEXT, decision_note TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
      CREATE INDEX IF NOT EXISTS idx_events_project ON events(project_id);
    `);
  }

  // ---- projects ----
  createProject(p: { project_id: string; name: string; idea: string }) {
    this.db
      .prepare('INSERT INTO projects(project_id,name,idea,phase,status,created_at) VALUES(?,?,?,?,?,?)')
      .run(p.project_id, p.name, p.idea, 'analysis', 'running', new Date().toISOString());
  }

  getProject(id: string): ProjectRow | undefined {
    return this.db.prepare('SELECT * FROM projects WHERE project_id=?').get(id) as ProjectRow | undefined;
  }

  listProjects(): ProjectRow[] {
    return this.db.prepare('SELECT * FROM projects ORDER BY created_at DESC').all() as unknown as ProjectRow[];
  }

  updateProject(id: string, phase: string, status: string) {
    this.db.prepare('UPDATE projects SET phase=?, status=? WHERE project_id=?').run(phase, status, id);
  }

  addApprovedCheckpoint(id: string, checkpoint: string) {
    const row = this.getProject(id);
    if (!row) return;
    const list: string[] = JSON.parse(row.approved_checkpoints || '[]');
    if (!list.includes(checkpoint)) list.push(checkpoint);
    this.db.prepare('UPDATE projects SET approved_checkpoints=? WHERE project_id=?').run(JSON.stringify(list), id);
  }

  // ---- tasks ----
  createTask(t: {
    task_id: string;
    project_id: string;
    title: string;
    description: string;
    owner: string;
    dependencies: string[];
    priority: string;
    acceptance_criteria: string[];
  }) {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO tasks(task_id,project_id,title,description,owner,dependencies,status,priority,acceptance_criteria,artifacts,attempts,created_at,updated_at)
         VALUES(?,?,?,?,?,?,?,?,?, '[]', 0, ?, ?)`
      )
      .run(
        t.task_id,
        t.project_id,
        t.title,
        t.description,
        t.owner,
        JSON.stringify(t.dependencies),
        'pending',
        t.priority,
        JSON.stringify(t.acceptance_criteria),
        now,
        now
      );
  }

  getTask(taskId: string): TaskRow | undefined {
    return this.db.prepare('SELECT * FROM tasks WHERE task_id=?').get(taskId) as TaskRow | undefined;
  }

  listTasks(projectId: string): TaskRow[] {
    return this.db.prepare('SELECT * FROM tasks WHERE project_id=? ORDER BY created_at').all(projectId) as unknown as TaskRow[];
  }

  updateTaskStatus(taskId: string, status: string, blockReason?: string | null) {
    this.db
      .prepare('UPDATE tasks SET status=?, block_reason=?, updated_at=? WHERE task_id=?')
      .run(status, blockReason ?? null, new Date().toISOString(), taskId);
  }

  incrementAttempts(taskId: string) {
    this.db.prepare('UPDATE tasks SET attempts=attempts+1, updated_at=? WHERE task_id=?').run(new Date().toISOString(), taskId);
  }

  addTaskArtifact(taskId: string, artifactKey: string) {
    const t = this.getTask(taskId);
    if (!t) return;
    const list: string[] = JSON.parse(t.artifacts || '[]');
    if (!list.includes(artifactKey)) list.push(artifactKey);
    this.db.prepare('UPDATE tasks SET artifacts=?, updated_at=? WHERE task_id=?').run(JSON.stringify(list), new Date().toISOString(), taskId);
  }

  // ---- events ----
  logEvent(e: {
    project_id: string;
    agent: string;
    task_id?: string | null;
    event_type: string;
    status: string;
  }) {
    this.db
      .prepare('INSERT INTO events(event_id,timestamp,project_id,agent,task_id,event_type,status) VALUES(?,?,?,?,?,?,?)')
      .run(newId('evt'), new Date().toISOString(), e.project_id, e.agent, e.task_id ?? null, e.event_type, e.status);
  }

  listEvents(projectId: string, limit = 200) {
    return this.db
      .prepare('SELECT * FROM events WHERE project_id=? ORDER BY timestamp DESC LIMIT ?')
      .all(projectId, limit) as Array<{ event_id: string; timestamp: string; project_id: string; agent: string; task_id: string | null; event_type: string; status: string }>;
  }

  // ---- artifacts ----
  saveArtifact(a: { key: string; project_id: string; task_id: string | null; agent: string; mime: string; path: string }) {
    this.db
      .prepare('INSERT OR REPLACE INTO artifacts(key,project_id,task_id,agent,mime,path,created_at) VALUES(?,?,?,?,?,?,?)')
      .run(a.key, a.project_id, a.task_id, a.agent, a.mime, a.path, new Date().toISOString());
  }

  getArtifact(projectId: string, key: string) {
    return this.db.prepare('SELECT * FROM artifacts WHERE project_id=? AND key=?').get(projectId, key) as
      | { key: string; project_id: string; task_id: string | null; agent: string; mime: string; path: string; created_at: string }
      | undefined;
  }

  listArtifacts(projectId: string) {
    return this.db.prepare('SELECT * FROM artifacts WHERE project_id=? ORDER BY created_at').all(projectId) as Array<{
      key: string;
      project_id: string;
      task_id: string | null;
      agent: string;
      mime: string;
      path: string;
      created_at: string;
    }>;
  }

  // ---- messages ----
  logMessage(m: {
    project_id: string;
    from_agent: string;
    to_agent: string;
    task_id: string | null;
    message_type: string;
    objective: string;
    status: string;
    priority: string;
    requires_approval: boolean;
  }) {
    this.db
      .prepare(
        'INSERT INTO messages(message_id,project_id,from_agent,to_agent,task_id,message_type,objective,status,priority,requires_approval,timestamp) VALUES(?,?,?,?,?,?,?,?,?,?,?)'
      )
      .run(
        newId('msg'),
        m.project_id,
        m.from_agent,
        m.to_agent,
        m.task_id,
        m.message_type,
        m.objective,
        m.status,
        m.priority,
        m.requires_approval ? 1 : 0,
        new Date().toISOString()
      );
  }

  listMessages(projectId: string) {
    return this.db.prepare('SELECT * FROM messages WHERE project_id=? ORDER BY timestamp').all(projectId);
  }

  // ---- approvals ----
  createApproval(a: { project_id: string; task_id: string | null; checkpoint: string; request_reason: string; requested_by: string; artifacts: string[] }) {
    const id = newId('appr');
    this.db
      .prepare('INSERT INTO approvals(approval_id,project_id,task_id,checkpoint,request_reason,requested_by,artifacts,status,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(id, a.project_id, a.task_id, a.checkpoint, a.request_reason, a.requested_by, JSON.stringify(a.artifacts), 'pending', new Date().toISOString());
    return id;
  }

  getApproval(id: string) {
    return this.db.prepare('SELECT * FROM approvals WHERE approval_id=?').get(id) as
      | { approval_id: string; project_id: string; task_id: string | null; checkpoint: string; request_reason: string; requested_by: string; artifacts: string; status: string; created_at: string; decided_at: string | null; decided_by: string | null; decision_note: string | null }
      | undefined;
  }

  listApprovals(projectId: string) {
    return this.db.prepare('SELECT * FROM approvals WHERE project_id=? ORDER BY created_at').all(projectId);
  }

  decideApproval(id: string, decision: 'approved' | 'rejected', by: string, note: string) {
    this.db
      .prepare('UPDATE approvals SET status=?, decided_at=?, decided_by=?, decision_note=? WHERE approval_id=?')
      .run(decision, new Date().toISOString(), by, note, id);
  }

  pendingApprovals(projectId: string) {
    return this.db.prepare("SELECT * FROM approvals WHERE project_id=? AND status='pending' ORDER BY created_at").all(projectId);
  }

  // ---- aggregate metrics ----
  projectMetrics(projectId: string) {
    const tasks = this.listTasks(projectId);
    const byStatus: Record<string, number> = {};
    for (const t of tasks) byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;
    const events = this.listEvents(projectId, 10000);
    return {
      tasks_total: tasks.length,
      tasks_by_status: byStatus,
      events_total: events.length,
      failed_tasks: byStatus['failed'] ?? 0,
      pending_approvals: (this.pendingApprovals(projectId) as unknown[]).length,
    };
  }

  close() {
    this.db.close();
  }
}
