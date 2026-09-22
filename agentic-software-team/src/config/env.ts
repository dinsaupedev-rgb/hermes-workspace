import { ModelGateway, GatewayConfig, ModelRoute } from '../gateway/model.js';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export function loadGatewayConfig(): GatewayConfig {
  const envPath = join(process.cwd(), '.env');
  const env: Record<string, string> = { ...process.env as Record<string, string> };
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m && !env[m[1]]) env[m[1]] = m[2];
    }
  }
  const baseUrl = env.OPENCODE_BASE_URL || 'https://opencode.ai/zen/go/v1';
  const apiKey = env.OPENCODE_API_KEY || env.OPENCODE_GO_API_KEY || '';
  if (!apiKey) throw new Error('Missing OPENCODE_API_KEY / OPENCODE_GO_API_KEY — set it in .env');
  const primary: ModelRoute = {
    provider: 'opencode-go',
    model: env.OPENCODE_MODEL || 'glm-5.3-flash',
    baseUrl,
    apiKey,
    sessionHeader: 'asteam',
    maxTokens: 4000,
  };
  return {
    routes: { default: primary },
    kindRoutes: {
      default: 'default',
      // All kinds use the same configured route in MVP; override kinds here when adding more routes.
      cheap: (env.OPENCODE_MODEL_CHEAP as unknown as 'default') || 'default',
      'high-reasoning': (env.OPENCODE_MODEL_REASONING as unknown as 'default') || 'default',
      coding: (env.OPENCODE_MODEL_CODING as unknown as 'default') || 'default',
      evaluation: (env.OPENCODE_MODEL_EVAL as unknown as 'default') || 'default',
    } as GatewayConfig['kindRoutes'],
  };
}

export function makeGateway(budgetUsd = Number(process.env.MAX_PROJECT_COST ?? 50)) {
  const cfg = loadGatewayConfig();
  return new ModelGateway(cfg, Number.isFinite(budgetUsd) ? budgetUsd : 50);
}
