import type {
  JsonObject,
  ProviderExecutionRequest,
  ProviderExecutionResult,
  ProviderName,
  UsageRecord,
} from "@neuralayer/core";

import type {
  ProviderAdapter,
  ProviderAdapterNormalizedError,
  ProviderAdapterUsage,
  ProviderAdapterValidationResult,
  ProviderApiKeyConfig,
} from "../contracts";

export interface StubProviderResponse {
  model: string;
  responseId: string;
  finishReason: "not_implemented";
  usage?: ProviderAdapterUsage;
  error: ProviderAdapterNormalizedError;
}

export interface StubProviderAdapterOptions<
  TProviderRequest,
  TProviderResponse extends StubProviderResponse,
> {
  provider: ProviderName;
  buildRequest(
    input: ProviderExecutionRequest,
    config: ProviderApiKeyConfig,
  ): TProviderRequest;
  invoke(
    request: TProviderRequest,
    config: ProviderApiKeyConfig,
  ): Promise<TProviderResponse>;
}

export function validateApiKeyConfiguration(
  config: ProviderApiKeyConfig,
): ProviderAdapterValidationResult {
  if (config?.apiKey?.trim()) {
    return { ok: true };
  }

  return {
    ok: false,
    errors: ["Provider apiKey is required."],
  };
}

function createStubMetadata(
  provider: ProviderName,
  extra?: Record<string, string | boolean | string[]>,
): JsonObject {
  const metadata: JsonObject = {
    provider,
    stub: true,
  };

  if (!extra) {
    return metadata;
  }

  for (const [key, value] of Object.entries(extra)) {
    metadata[key] = value;
  }

  return metadata;
}

export function createNotImplementedError(
  provider: ProviderName,
  options: {
    cause?: string;
    code?: string;
    message?: string;
  } = {},
): ProviderAdapterNormalizedError {
  const {
    cause,
    code = "not_implemented",
    message = `${provider} adapter stub is not implemented.`,
  } = options;

  return {
    type: "unknown_provider_error",
    code,
    message,
    retryable: false,
    metadata: createStubMetadata(provider, cause ? { cause } : undefined),
  };
}

function createInvalidConfigurationResult(
  provider: ProviderName,
  model: string,
  errors: string[],
): ProviderExecutionResult {
  return {
    provider,
    model,
    requestStatus: "failed",
    error: {
      type: "invalid_request",
      code: "invalid_provider_configuration",
      message: errors.join("; "),
      retryable: false,
      metadata: createStubMetadata(provider, { errors }),
    },
  };
}

function materializeUsage(
  provider: ProviderName,
  model: string,
  usage: ProviderAdapterUsage | undefined,
): UsageRecord | undefined {
  if (!usage) {
    return undefined;
  }

  return {
    provider,
    model,
    ...usage,
  };
}

export function createStubProviderAdapter<
  TProviderRequest,
  TProviderResponse extends StubProviderResponse,
>({
  provider,
  buildRequest,
  invoke,
}: StubProviderAdapterOptions<
  TProviderRequest,
  TProviderResponse
>): ProviderAdapter<ProviderApiKeyConfig, TProviderRequest, TProviderResponse> {
  const validateConfiguration = (config: ProviderApiKeyConfig) =>
    validateApiKeyConfiguration(config);

  const extractUsage = (response: TProviderResponse) => response.usage;

  const normalizeResponse = (
    response: TProviderResponse,
    input: ProviderExecutionRequest,
  ): ProviderExecutionResult => {
    const model = response.model || input.decision.selected.model;

    return {
      provider,
      model,
      requestStatus: "failed",
      finishReason: response.finishReason,
      responseId: response.responseId,
      usage: materializeUsage(provider, model, extractUsage(response)),
      error: response.error,
    };
  };

  const normalizeError = (error: unknown): ProviderAdapterNormalizedError => {
    const cause =
      error instanceof Error
        ? error.message
        : typeof error === "string"
          ? error
          : "Unexpected stub provider adapter failure.";

    return createNotImplementedError(provider, { cause });
  };

  return {
    provider,
    capabilities: {
      byok: true,
      streaming: false,
    },
    validateConfiguration,
    buildRequest,
    invoke,
    normalizeResponse,
    normalizeError,
    extractUsage,
    async execute(
      input: ProviderExecutionRequest,
      config: ProviderApiKeyConfig,
    ): Promise<ProviderExecutionResult> {
      const validation = validateConfiguration(config);

      if (!validation.ok) {
        return createInvalidConfigurationResult(
          provider,
          input.decision.selected.model,
          validation.errors,
        );
      }

      try {
        const providerRequest = buildRequest(input, config);
        const providerResponse = await invoke(providerRequest, config);
        return normalizeResponse(providerResponse, input);
      } catch (error) {
        return {
          provider,
          model: input.decision.selected.model,
          requestStatus: "failed",
          error: normalizeError(error),
        };
      }
    },
  };
}
