import type { ProviderName } from "../enums";

export interface UsageRecord {
  provider: ProviderName;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  costUsd?: number;
  latencyMs?: number;
}
