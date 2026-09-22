import { loadGatewayConfig } from '../src/config/env.ts';
import { ModelGateway } from '../src/gateway/model.ts';
const cfg = loadGatewayConfig();
console.log('route model:', cfg.routes.default.model, 'keylen:', cfg.routes.default.apiKey.length);
const gw = new ModelGateway(cfg, 50);
const res = await gw.call([{ role: 'user', content: 'Reply with exactly: {"ok":true}' }], { kind: 'default', maxTokens: 100, temperature: 0, timeoutMs: 60000 }, 'probe', 'probe');
console.log('content len:', res.content.length);
console.log('content:', JSON.stringify(res.content.slice(0, 300)));
