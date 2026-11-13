import type {
  NormalizedProviderError,
  ProviderExecutionRequest,
  ProviderExecutionResult,
  ProviderName,
  UsageRecord,
} from "@neuralayer/core";

export interface ProviderAdapterCapabilities {
  byok: true;
  streaming: false;
  supportedModels?: readonly string[];
}

export interface ProviderApiKeyConfig {
  apiKey: string;
}

export type ProviderAdapterNormalizedError = NormalizedProviderError;
export type ProviderAdapterUsage = Omit<UsageRecord, "provider" | "model">;

export type ProviderAdapterValidationResult =
  | { ok: true }
  | { ok: false; errors: string[] };

export interface ProviderAdapter<
  TConfig = ProviderApiKeyConfig,
  TProviderRequest = unknown,
  TProviderResponse = unknown,
> {
  provider: ProviderName;
  capabilities: ProviderAdapterCapabilities;
  validateConfiguration(config: TConfig): ProviderAdapterValidationResult;
  buildRequest(
    input: ProviderExecutionRequest,
    config: TConfig,
  ): TProviderRequest;
  invoke(
    request: TProviderRequest,
    config: TConfig,
  ): Promise<TProviderResponse>;
  normalizeResponse(
    response: TProviderResponse,
    input: ProviderExecutionRequest,
  ): ProviderExecutionResult;
  normalizeError(error: unknown): ProviderAdapterNormalizedError;
  extractUsage(response: TProviderResponse): ProviderAdapterUsage | undefined;
  execute(
    input: ProviderExecutionRequest,
    config: TConfig,
  ): Promise<ProviderExecutionResult>;
}

export interface ProviderConnectionTestInput {
  provider: ProviderName;
  model: string;
  requestId: string;
  config: ProviderApiKeyConfig;
}

export interface ProviderConnectionTestRunner {
  run(input: ProviderConnectionTestInput): Promise<ProviderExecutionResult>;
}

export interface ProviderRegistry {
  get(provider: ProviderName): ProviderAdapter | undefined;
  list(): ProviderAdapter[];
}

export function createProviderRegistry(
  adapters: readonly ProviderAdapter[],
): ProviderRegistry {
  const adapterMap = new Map(
    adapters.map((adapter) => [adapter.provider, adapter]),
  );

  return {
    get(provider) {
      return adapterMap.get(provider);
    },
    list() {
      return [...adapterMap.values()];
    },
  };
}
