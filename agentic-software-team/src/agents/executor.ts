import { CallOptions, ChatMessage } from '../gateway/registry.js';
import { ModelGateway } from '../gateway/model.js';
import { AgentDef } from './definitions.js';
import { RecordStore } from '../store/store.js';
import { newId, extractJson } from '../core/runtime.js';

/**
 * AgentExecutionState is the explicit per-agent runtime state machine:
 * IDLE -> PLANNING -> EXECUTING -> WAITING_FOR_TOOL -> WAITING_FOR_AGENT
 *   -> WAITING_FOR_APPROVAL -> REVIEW -> COMPLETED
 * Failure states: FAILED | BLOCKED | RETRYING | ESCALATED
 */
export type AgentState =
  | 'IDLE'
  | 'PLANNING'
  | 'EXECUTING'
  | 'WAITING_FOR_TOOL'
  | 'WAITING_FOR_AGENT'
  | 'WAITING_FOR_APPROVAL'
  | 'REVIEW'
  | 'COMPLETED'
  | 'FAILED'
  | 'BLOCKED'
  | 'RETRYING'
  | 'ESCALATED';

export interface AgentRunContext {
  projectId: string;
  taskId?: string | null;
  idea: string;
  promptVars: Record<string, string>;
  workingDir: string;
  previousTasks: string[];
}

export interface AgentRunResult {
  state: AgentState;
  json: Record<string, unknown>;
  rawText: string;
  attempts: number;
  failureReason?: string;
}

export interface AgentRunEvent {
  event_type: string;
  status: 'ok' | 'error' | 'warn';
  details?: string;
  latency_ms?: number;
}

const CALL_OPTS_BY_KIND: Record<AgentDef['kind'], Partial<CallOptions>> = {
  default: { kind: 'default' },
  cheap: { kind: 'cheap', maxTokens: 2000, temperature: 0.1 },
  'high-reasoning': { kind: 'high-reasoning', maxTokens: 4000, temperature: 0.3 },
  coding: { kind: 'coding', maxTokens: 12000, temperature: 0.2 },
  evaluation: { kind: 'evaluation', maxTokens: 2000, temperature: 0.05 },
};

const MAX_ATTEMPTS = 3;

export class AgentExecutor {
  constructor(
    private gateway: ModelGateway,
    private store: RecordStore,
  ) {}

  async run(def: AgentDef, ctx: AgentRunContext): Promise<AgentRunResult> {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      let state: AgentState = 'PLANNING';
      try {
        this.store.logEvent({
          project_id: ctx.projectId,
          agent: def.name,
          task_id: null,
          event_type: 'agent.state',
          status: `PLANNING attempt=${attempt}`,
        });
        state = 'EXECUTING';
        const messages: ChatMessage[] = [
          { role: 'system', content: def.systemPrompt },
          { role: 'user', content: renderPrompt(def, ctx) },
        ];
        const opts: CallOptions = {
          kind: 'default',
          maxTokens: 3000,
          temperature: 0.2,
          timeoutMs: 120_000,
          ...CALL_OPTS_BY_KIND[def.kind],
        };
        const res = await this.gateway.call(messages, opts, ctx.projectId, def.name);
        state = 'WAITING_FOR_TOOL';
        const json = extractJson(res.content, (err) => {
          throw Object.assign(new Error(`agent ${def.name} produced invalid JSON: ${err.message}`), {
            retryable: true,
          });
        }) as Record<string, unknown>;
        state = 'REVIEW';
        this.store.logEvent({
          project_id: ctx.projectId,
          agent: def.name,
          task_id: null,
          event_type: 'agent.run',
          status: `ok latency=${res.latencyMs}ms tokensIn=${res.tokensIn} tokensOut=${res.tokensOut} cost=$${res.costUsdEst.toFixed(6)}`,
        });
        return {
          state: 'COMPLETED',
          json,
          rawText: res.content,
          attempts: attempt,
        };
      } catch (e) {
        const err = e as Error & { retryable?: boolean; code?: string };
        const retryable = err.retryable === true || /timeout|429|5\d\d|network|ECONN/i.test(err.message);
        if (attempt < MAX_ATTEMPTS && retryable) {
          state = 'RETRYING';
          this.store.logEvent({
            project_id: ctx.projectId,
            agent: def.name,
            task_id: null,
            event_type: 'agent.state',
            status: `RETRYING (attempt ${attempt} failed: ${err.message.slice(0, 160)})`,
          });
          await new Promise((r) => setTimeout(r, 500 * attempt));
          continue;
        }
        this.store.logEvent({
          project_id: ctx.projectId,
          agent: def.name,
          task_id: null,
          event_type: 'agent.run',
          status: `error ${err.message.slice(0, 200)}`,
        });
        return {
          state: err.code === 'BUDGET_EXCEEDED' ? 'ESCALATED' : 'FAILED',
          json: {},
          rawText: '',
          attempts: attempt,
          failureReason: err.message,
        };
      }
    }
    return { state: 'FAILED', json: {}, rawText: '', attempts: MAX_ATTEMPTS, failureReason: 'exhausted attempts' };
  }
}

export function renderPrompt(def: AgentDef, ctx: AgentRunContext): string {
  let rendered = `Project idea:\n${ctx.idea}\n\nPrevious agents produced:\n${ctx.previousTasks.join('\n') || '(none - you are first)'}\n\nYour task (${def.name}):\n`;
  for (const [k, v] of Object.entries(ctx.promptVars)) {
    rendered += viz(`\n${k}:\n${v}\n`);
  }
  return rendered.trim();
}

function viz(s: string): string {
  return s;
}
