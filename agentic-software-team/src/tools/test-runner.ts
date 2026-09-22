import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export interface TestRunResult {
  ok: boolean;
  passed: number;
  failed: number;
  total: number;
  output: string;
  durationMs: number;
}

/**
 * Run the generated repo's tests with `node --test`.
 *
 * Two robustness measures matter here:
 * 1. Generated agents may use CommonJS (`require`) in .js files. If the repo has no
 *    package.json of its own we write one WITHOUT "type": "module" so Node treats
 *    .js as CJS (matching what the engineer agent typically emits).
 * 2. `node --test <dir>` parses every file loaded during execution against the
 *    ambient module system, so we pass explicit file paths instead.
 * 3. Paths are passed to node as absolute native paths — MSYS/relative path
 *    mangling makes non-absolute paths flaky on Windows.
 */
export function runTests(repoPath: string, timeoutMs = 120_000): TestRunResult {
  const repoAbs = resolve(repoPath);
  const dir = existsSync(join(repoAbs, 'tests')) ? 'tests' : existsSync(join(repoAbs, 'test')) ? 'test' : null;
  const started = Date.now();
  if (!dir) {
    return { ok: false, passed: 0, failed: 0, total: 0, output: 'no tests directory found', durationMs: 0 };
  }
  const pkgPath = join(repoAbs, 'package.json');
  if (!existsSync(pkgPath)) {
    writeFileSync(pkgPath, JSON.stringify({ name: 'generated-app', private: true }, null, 2), 'utf8');
  }
  const files = listTestFiles(join(repoAbs, dir));
  if (files.length === 0) {
    return { ok: false, passed: 0, failed: 0, total: 0, output: 'no test files found under ' + dir, durationMs: Date.now() - started };
  }
  const res = spawnSync('node', ['--test', '--test-force-exit', ...files], {
    cwd: repoAbs,
    encoding: 'utf8',
    timeout: timeoutMs,
    env: { ...process.env, NODE_OPTIONS: '' },
  });
  const out = `${res.stdout ?? ''}\n${res.stderr ?? ''}`.slice(0, 8000);
  const passed = countSummary(out, 'pass');
  const failed = countSummary(out, 'fail');
  return {
    ok: res.status === 0 && failed === 0,
    passed,
    failed,
    total: passed + failed,
    output: out,
    durationMs: Date.now() - started,
  };
}

function countSummary(out: string, kind: 'pass' | 'fail'): number {
  let best = 0;
  for (const m of out.matchAll(new RegExp(`(?:^|\\s)[#ℹ\\s]*${kind}\\s+(\\d+)`, 'gm'))) {
    const n = parseInt(m[1], 10);
    if (n > best) best = n;
  }
  return best;
}

function listTestFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.test\.(js|mjs|cjs|ts)$/.test(e.name) || /\.spec\.(js|mjs|cjs|ts)$/.test(e.name) || /^test[_-].*\.(js|mjs|cjs)$/.test(e.name)) out.push(full);
    }
  };
  walk(dir);
  return out;
}
