import { runTests } from '../src/tools/test-runner.ts';

// Manual check: run the generated repo's tests through the runner.
const repo = process.argv[2] ?? 'projects/proj_project_tracker_4aacc8fab1aa/repo';
const r = runTests(repo, 120_000);
console.log('ok:', r.ok, 'passed:', r.passed, 'failed:', r.failed, 'total:', r.total);
console.log('--- tail of output ---');
console.log(r.output.split('\n').slice(-15).join('\n'));
