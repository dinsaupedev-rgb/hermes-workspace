import { writeFileSync } from 'node:fs';

// Nothing here yet — placeholder for future ModelGateway budget config.
export const BUDGET_LIMIT = 50;

export function writeEnvExample(path: string) {
  writeFileSync(
    path,
    `OPENCODE_BASE_URL=https://opencode.ai/zen/go/v1
OPENCODE_API_KEY=sk-your-opencode-key
OPENCODE_MODEL=glm-5.3-flash
MAX_PROJECT_COST=50
`,
    'utf8'
  );
}
