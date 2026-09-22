import type { ChatMessage, CallOptions } from './registry.js';

export interface ModelRoute {
  provider: string;
  model: string;
  baseUrl: string;
  apiKey: string;
  sessionHeader?: string;
  maxTokens?: number;
}

export function routeFor(kind: TaskKind, cfg: GatewayConfig): ModelRoute {
  const k = cfg.kindRoutes[kind] ?? kind;
  const r = cfg.routes[k] ?? cfg.routes.default;
  if (!r) throw new Error(`No configured model route for task kind '${kind}'`);
  return r;
}
export type TaskKind = 'default' | 'cheap' | 'high-reasoning' | 'coding' | 'evaluation';

export interface GatewayConfig {
  routes: Record<string, ModelRoute>;
  kindRoutes: Record<string, TaskKind>;
}

export interface ChatResult {
  content: string;
  model: string;
  latencyMs: number;
  tokensIn: number;
  tokensOut: number;
  costUsdEst: number;
  raw: unknown;
}

export const TOKEN_PRICES_PER_1K: Record<string, { in: number; out: number }> = {
  default: { in: 0.0005, out: 0.0008 },
};

export function estimateCost(model: string, tokensIn: number, tokensOut: number): number {
  const p = TOKEN_PRICES_PER_1K[model] ?? TOKEN_PRICES_PER_1K['default'];
  return Math.round((tokensIn / 1000) * p.in * 1e6) / 1e6 + Math.round((tokensOut / 1000) * p.out * 1e6) / 1e6;
}

export class ModelGateway {
  private remainingBudgetUsd: number;

  constructor(private cfg: GatewayConfig, budgetUsd = Infinity) {
    this.remainingBudgetUsd = budgetUsd;
    if (typeof budgetUsd !== 'number') throw new Error('budgetUsd must be a finite number');
  }

  get remainingBudget(): number {
    return this.remainingBudgetUsd;
  }

  async call(messages: ChatMessage[], opts: CallOptions, project: string, taskId: string): Promise<ChatResult> {
    if (this.remainingBudgetUsd <= 0) {
      const err = new Error('project budget exhausted — refusing model call (budget guard)');
      (err as Error & { code: string }).code = 'BUDGET_EXCEEDED';
      throw err;
    }
    const route = routeFor(opts.kind ?? 'default', this.cfg);
    const started = Date.now();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${route.apiKey}`,
    };
    if (route.sessionHeader) headers['x-opencode-session'] = `${project}-${taskId}`.slice(0, 80);
    const controller = new AbortController();
    const timeoutMs = opts.timeoutMs ?? 120_000;
    const t: NodeJS.Timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${route.baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        signal: controller.signal,
        body: JSON.stringify({
          model: route.model,
          messages,
          max_tokens: opts.maxTokens ?? route.maxTokens ?? 3000,
          temperature: opts.temperature ?? 0.2,
        }),
      });
      if (!res.ok) {
        const retryable = res.status === 429 || res.status >= 500;
        const body = await res.text().catch(() => '');
        throw Object.assign(new Error(`gateway HTTP ${res.status}: ${body.slice(0, 200)}`), {
          retryable,
          httpStatus: res.status,
        });
      }
      const json = await res.json();
      const { content, reasoning, finishReason } = unwrapContent(json);
      const latencyMs = Date.now() - started;
      const u = json.usage || {};
      const cost = estimateCost(route.model, u.prompt_tokens ?? 0, u.completion_tokens ?? 0);
      this.remainingBudgetUsd = Math.max(0, this.remainingBudgetUsd - cost);
      if (!content && finishReason === 'length') {
        throw Object.assign(new Error('model hit token limit before producing any content'), { retryable: true });
      }
      return {
        content,
        model: route.model,
        latencyMs,
        tokensIn: u.prompt_tokens ?? 0,
        tokensOut: u.completion_tokens ?? 0,
        costUsdEst: cost,
        raw: { reasoning, finishReason },
      };
    } catch (e) {
      const err = e as Error & { retryable?: boolean; httpStatus?: number; code?: string };
      if (err.code === 'BUDGET_EXCEEDED') throw err;
      if (err.name === 'AbortError') {
        throw Object.assign(new Error(`gateway timeout after ${timeoutMs}ms`), { retryable: true });
      }
      throw err;
    } finally {
      clearTimeout(t);
    }
  }
}

/** Extract assistant content + optional reasoning from an OpenAI-compatible chat completion. */
export function unwrapContent(json: unknown): { content: string; reasoning?: string; finishReason?: string } {
  const j = json as Record<string, unknown>;
  const choices = (j?.choices as Array<{ message?: Record<string, unknown>; finish_reason?: string }>) ?? [];
  const choice = choices[0] ?? {};
  const msg = choice.message ?? {};
  const reasoning = typeof msg.reasoning_content === 'string' ? msg.reasoning_content : undefined;
  const rawContent = msg.content;
  const content =
    typeof rawContent === 'string'
      ? rawContent
      : Array.isArray(rawContent)
        ? (rawContent as Array<{ type?: string; text?: string }>)
            .filter((p) => p?.type === 'text' && typeof p.text === 'string')
            .map((p) => p.text)
            .join('')
        : '';
  return { content, reasoning, finishReason: typeof choice.finish_reason === 'string' ? choice.finish_reason : undefined };
}
