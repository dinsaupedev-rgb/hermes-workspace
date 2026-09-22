import { loadGatewayConfig } from '../src/config/env.ts';
import { ModelGateway } from '../src/gateway/model.ts';
import { AGENTS } from '../src/agents/definitions.ts';
import { readFileSync } from 'node:fs';

const cfg = loadGatewayConfig();
const gw = new ModelGateway(cfg, 5);

const idea = 'Build a web application that tracks personal software projects';
const requirements = JSON.parse(readFileSync(new URL('../projects/proj_project_tracker__88ab27226440/artifacts/requirements.json', import.meta.url), 'utf8'));
const architecture = JSON.parse(readFileSync(new URL('../projects/proj_project_tracker__88ab27226440/artifacts/architecture.json', import.meta.url), 'utf8'));

function renderPrompt(def, idea, previous) {
  let out = `Project idea:\n${idea}\n\nPrevious agents produced:\n`;
  for (const [title, json] of previous) {
    out += `\n### ${title}\n${json.slice(0, 8000)}\n`;
  }
  out += `\nYour task (${def.name}). ${def.systemPrompt}\nRespond now.`;
  return out;
}

const def = AGENTS.find((a) => a.name === 'engineer');
const messages = [
  { role: 'system', content: def.systemPrompt },
  {
    role: 'user',
    content: renderPrompt(
      def,
      idea,
      [
        ['requirements.json', JSON.stringify(requirements)],
        ['architecture.json', JSON.stringify(architecture)],
      ],
    ),
  },
];
const res = await gw.call(messages, { kind: 'coding', maxTokens: 12000, temperature: 0.2, timeoutMs: 280_000 }, 'probe2', 'engineer');
console.log('finish:', res.raw?.finishReason, 'latency:', res.latencyMs, 'tokOut:', res.tokensOut, 'contentLen:', res.content.length);
const hasJson = /"files"\s*:/.test(res.content);
console.log('has files key:', hasJson);
// Try extracting using the same algorithm as runtime.extractJson
let depth = 0, start = -1, end = -1, inString = false, escape = false;
for (let i = 0; i < res.content.length; i++) {
  const ch = res.content[i];
  if (escape) { escape = false; continue; }
  if (ch === '\\' && inString) { escape = true; continue; }
  if (ch === '"') inString = !inString;
  else if (!inString && ch === '{') { if (depth === 0) start = i; depth++; }
  else if (!inString && ch === '}') { depth--; if (depth === 0 && start !== -1) { end = i + 1; break; } }
}
console.log('balanced span:', start, end, end > 0 ? 'PARSEABLE?' : '');
if (end > 0) {
  try {
    const j = JSON.parse(res.content.slice(start, end));
    console.log('parsed OK — files:', (j.files || []).length, 'tests:', (j.tests || []).length);
  } catch (e) {
    console.log('parse error:', e.message);
  }
} else {
  console.log('NOT BALANCED — model output truncated. Last char:', JSON.stringify(res.content.slice(-1)));
}
