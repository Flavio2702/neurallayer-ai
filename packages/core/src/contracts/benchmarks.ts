import type { BenchmarkSourceName, ProviderName } from "../enums";

import type { JsonObject } from "./common";

export interface NormalizedExternalModelBenchmark {
  externalStableModelId: string;
  provider: ProviderName;
  modelId: string;
  mappingKey: string;
  externalModelSlug?: string;
  externalModelName?: string;
  externalProviderSlug?: string;
  externalProviderName?: string;
  qualityGeneralScore?: number;
  qualityCodingScore?: number;
  priceInputPer1mTokensUsd?: number;
  priceOutputPer1mTokensUsd?: number;
  outputTokensPerSecond?: number;
  timeToFirstTokenMs?: number;
  syncedAt?: string;
  rawPayload?: JsonObject;
}

export interface BenchmarkDescriptor {
  sourceName: BenchmarkSourceName;
  syncedAt: string;
}
