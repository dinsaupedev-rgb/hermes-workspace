import { runTests } from '../src/tools/test-runner.ts';

const repo = process.argv[2] ?? 'projects/proj_project_tracker_ce53e6b7bd8a/repo';
const r = runTests(repo, 30_000);
console.log('ok:', r.ok, 'passed:', r.passed, 'failed:', r.failed);
console.log('output:');
console.log(r.output.slice(0, 800));
