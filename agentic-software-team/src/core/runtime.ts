import { randomUUID } from 'node:crypto';

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

/** Last balanced {...} block inside text — resilient to prose before the JSON. */
export function extractJson<T>(raw: string, fallback: (e: Error) => T): T {
  if (!raw || typeof raw !== 'string') return fallback(new Error('empty model output'));
  let depth = 0, start = -1, end = -1, inString = false, escape = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') inString = !inString;
    else if (!inString && ch === '{') { if (depth === 0) start = i; depth++; }
    else if (!inString && ch === '}') { depth--; if (depth === 0 && start !== -1) { end = i + 1; break; } }
  }
  if (start === -1 || end === -1) return fallback(new Error('no JSON object found'));
  try {
    return JSON.parse(raw.slice(start, end)) as T;
  } catch (e) {
    return fallback(e as Error);
  }
}

/** Depth-limited trim of model-provided tool args: cap string length and array size. Functions and undefined are dropped by JSON round-trip upstream; here they are skipped. */
export function sanitizeToolArgs(obj: unknown): Record<string, unknown> {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'function' || v === undefined) continue; // drop non-JSON-safe values
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || v === null) {
      out[k] = typeof v === 'string' ? v.slice(0, 4000) : v;
    } else if (Array.isArray(v)) {
      out[k] = v.slice(0, 50).map((x) => (typeof x === 'string' ? x.slice(0, 2000) : x));
    } else {
      out[k] = sanitizeToolArgs(v);
    }
  }
  return out;
}
