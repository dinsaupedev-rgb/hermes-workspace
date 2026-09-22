export type CallOptions = {
  kind: 'default' | 'cheap' | 'high-reasoning' | 'coding' | 'evaluation';
  maxTokens: number;
  temperature: number;
  timeoutMs: number;
};

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };
