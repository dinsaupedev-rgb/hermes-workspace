import { join } from 'node:path';
import { RecordStore } from '../store/store.js';
import { Orchestrator, DEFAULT_ORCH_CONFIG } from '../core/orchestrator.js';
import { makeGateway } from '../config/env.js';
import { newId } from '../core/runtime.js';

export async function createProject(name: string, idea: string, mode: 'auto' | 'manual') {
  const store = new RecordStore(join(process.cwd(), 'data', 'asteam.db'));
  const projectId = newId(`proj_${name.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase().slice(0, 16)}`);
  store.createProject({ project_id: projectId, name: `${name}_${projectId.slice(-6)}`, idea });
  const orchestrator = new Orchestrator(
    makeGateway(),
    store,
    mode === 'auto'
      ? { ...DEFAULT_ORCH_CONFIG, autoApprove: ['requirements', 'architecture', 'code_changes', 'qa', 'security'] }
      : DEFAULT_ORCH_CONFIG,
  );
  const run = await orchestrator.run(projectId, idea);
  store.close();
  return { projectId, run };
}

if (process.argv[1] && process.argv[1].endsWith('create-project.ts')) {
  const args = process.argv.slice(2);
  const getArg = (flag: string) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const idea = getArg('--idea') ?? 'Build a web application that tracks personal software projects';
  const name = getArg('--name') ?? 'demo';
  const mode = (getArg('--auto') ? 'auto' : 'manual') as 'auto' | 'manual';
  createProject(name, idea, mode)
    .then(({ projectId, run }) => {
      console.log('\n=== FINAL ===');
      console.log('project:', projectId);
      console.log('status:', run.status);
      console.log('tests:', run.testResult ? `${run.testResult.passed}/${run.testResult.total} passed` : 'no tests run');
      process.exit(run.status === 'completed' ? 0 : 1);
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
