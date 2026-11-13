import type {
  JsonObject,
  Message,
  ProviderExecutionRequest,
  ProviderExecutionResult,
  UsageRecord,
} from "@neuralayer/core";

import type {
  ProviderAdapter,
  ProviderAdapterNormalizedError,
  ProviderApiKeyConfig,
} from "../contracts";
import { validateApiKeyConfiguration } from "./shared";

const ANTHROPIC_PROVIDER_NAME = "anthropic" as const;
const DEFAULT_ANTHROPIC_BASE_URL = "https://api.anthropic.com/v1";
const DEFAULT_ANTHROPIC_TIMEOUT_MS = 30_000;
const DEFAULT_ANTHROPIC_MAX_TOKENS = 1_024;
const DEFAULT_ANTHROPIC_VERSION = "2023-06-01";

type AnthropicRole = Extract<Message["role"], "user" | "assistant">;

interface AnthropicContentBlock {
  type: "text";
  text: string;
}

interface AnthropicMessage {
  role: AnthropicRole;
  content: AnthropicContentBlock[];
}

export interface AnthropicProviderRequest {
  body: {
    model: string;
    max_tokens: number;
    messages: AnthropicMessage[];
    stream: false;
    system?: string;
  };
  headers: Record<string, string>;
  model: string;
  requestId: string;
  timeoutMs: number;
  url: string;
}

interface AnthropicResponseHeaders {
  requestId?: string;
}

export interface AnthropicProviderResponse {
  body?: unknown;
  headers: AnthropicResponseHeaders;
  latencyMs: number;
  ok: boolean;
  parseError?: string;
  rawBody?: string;
  statusCode: number;
}

export interface AnthropicAdapterOptions {
  anthropicVersion?: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  maxTokens?: number;
  timeoutMs?: number;
}

class AnthropicTransportError extends Error {
  constructor(
    public readonly kind: "network" | "timeout" | "unknown",
    message: string,
    public readonly latencyMs: number,
    options: {
      cause?: unknown;
    } = {},
  ) {
    super(message, options);
    this.name = "AnthropicTransportError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(
  value: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const candidate = value?.[key];

  return typeof candidate === "string" ? candidate : undefined;
}

function readNumber(
  value: Record<string, unknown> | undefined,
  key: string,
): number | undefined {
  const candidate = value?.[key];

  return typeof candidate === "number" && Number.isFinite(candidate)
    ? candidate
    : undefined;
}

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.replace(/\/+$/, "");
}

function buildResponseHeaders(headers: Headers): AnthropicResponseHeaders {
  return {
    requestId: headers.get("request-id") ?? undefined,
  };
}

function buildDiagnosticMetadata(
  options: {
    errorType?: string;
    headers?: AnthropicResponseHeaders;
    rawBodyPreview?: string;
    statusCode?: number;
    timeoutMs?: number;
  } = {},
): JsonObject | undefined {
  const metadata: JsonObject = {};

  if (options.statusCode !== undefined) {
    metadata.status_code = options.statusCode;
  }

  if (options.errorType) {
    metadata.anthropic_error_type = options.errorType;
  }

  if (options.headers?.requestId) {
    metadata["request-id"] = options.headers.requestId;
  }

  if (options.timeoutMs !== undefined) {
    metadata.timeout_ms = options.timeoutMs;
  }

  if (options.rawBodyPreview) {
    metadata.raw_body_preview = options.rawBodyPreview;
  }

  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

function toAnthropicMessages(messages: Message[]) {
  const systemMessages = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content.trim())
    .filter((message) => message.length > 0);
  const conversationMessages = messages
    .filter(
      (message): message is Message & { role: AnthropicRole } =>
        message.role === "user" || message.role === "assistant",
    )
    .map((message) => ({
      role: message.role,
      content: [
        {
          type: "text" as const,
          text: message.content,
        },
      ],
    }));

  return {
    system: systemMessages.length > 0 ? systemMessages.join("\n\n") : undefined,
    messages: conversationMessages,
  };
}

function extractErrorDetails(body: unknown) {
  const envelope = isRecord(body) ? body : undefined;
  const errorRecord = isRecord(envelope?.error) ? envelope.error : undefined;

  return {
    message: readString(errorRecord, "message"),
    type: readString(errorRecord, "type"),
  };
}

function extractResponseId(body: unknown, headers: AnthropicResponseHeaders) {
  const record = isRecord(body) ? body : undefined;

  return readString(record, "id") ?? headers.requestId;
}

function extractOutputText(body: unknown) {
  const record = isRecord(body) ? body : undefined;
  const contentBlocks = Array.isArray(record?.content) ? record.content : [];
  const textParts = contentBlocks
    .map((block) => {
      if (!isRecord(block) || block.type !== "text") {
        return null;
      }

      return typeof block.text === "string" ? block.text : null;
    })
    .filter((block): block is string => block !== null);

  return textParts.length > 0 ? textParts.join("") : undefined;
}

function extractFinishReason(body: unknown) {
  const record = isRecord(body) ? body : undefined;

  return readString(record, "stop_reason");
}

function extractUsageRecord(
  body: unknown,
  model: string,
): UsageRecord | undefined {
  const record = isRecord(body) ? body : undefined;
  const usageRecord = isRecord(record?.usage) ? record.usage : undefined;
  const inputTokens = readNumber(usageRecord, "input_tokens");
  const outputTokens = readNumber(usageRecord, "output_tokens");
  const totalTokens =
    inputTokens !== undefined && outputTokens !== undefined
      ? inputTokens + outputTokens
      : undefined;

  if (
    inputTokens === undefined &&
    outputTokens === undefined &&
    totalTokens === undefined
  ) {
    return undefined;
  }

  return {
    provider: ANTHROPIC_PROVIDER_NAME,
    model,
    inputTokens,
    outputTokens,
    totalTokens,
  };
}

function normalizeHttpFailure(
  response: AnthropicProviderResponse,
  input: ProviderExecutionRequest,
): ProviderExecutionResult {
  const errorDetails = extractErrorDetails(response.body);
  const rawBodyPreview =
    response.parseError || !response.body
      ? response.rawBody?.slice(0, 500)
      : undefined;
  const metadata = buildDiagnosticMetadata({
    errorType: errorDetails.type,
    headers: response.headers,
    rawBodyPreview,
    statusCode: response.statusCode,
  });
  const baseResult = {
    provider: ANTHROPIC_PROVIDER_NAME,
    model: input.decision.selected.model,
    requestStatus: "failed" as const,
    latencyMs: response.latencyMs,
    responseId: extractResponseId(response.body, response.headers),
  };

  if (response.statusCode === 401 || response.statusCode === 403) {
    return {
      ...baseResult,
      error: {
        type: "auth_error",
        code: "provider_auth_failed",
        message:
          errorDetails.message ??
          "Anthropic rejected the provided authentication credentials.",
        retryable: false,
        metadata,
      },
    };
  }

  if (response.statusCode === 429) {
    const errorType = errorDetails.type ?? "";

    return {
      ...baseResult,
      error: {
        type: errorType.includes("quota") ? "quota_exceeded" : "rate_limit",
        code: errorType.includes("quota")
          ? "provider_quota_exceeded"
          : "provider_rate_limited",
        message: errorDetails.message ?? "Anthropic rate limited the request.",
        retryable: true,
        metadata,
      },
    };
  }

  if ([400, 404, 422].includes(response.statusCode)) {
    return {
      ...baseResult,
      error: {
        type: "invalid_request",
        code: "invalid_provider_request",
        message:
          errorDetails.message ?? "Anthropic rejected the request payload.",
        retryable: false,
        metadata,
      },
    };
  }

  if (response.statusCode >= 500) {
    return {
      ...baseResult,
      error: {
        type: "provider_unavailable",
        code: "provider_unavailable",
        message: errorDetails.message ?? "Anthropic is currently unavailable.",
        retryable: true,
        metadata,
      },
    };
  }

  return {
    ...baseResult,
    error: {
      type: "unknown_provider_error",
      code: "unknown_provider_error",
      message:
        errorDetails.message ??
        `Anthropic returned an unexpected HTTP ${response.statusCode} response.`,
      retryable: false,
      metadata,
    },
  };
}

export function createAnthropicAdapter(
  options: AnthropicAdapterOptions = {},
): ProviderAdapter<
  ProviderApiKeyConfig,
  AnthropicProviderRequest,
  AnthropicProviderResponse
> {
  const fetchImpl = options.fetch ?? fetch;
  const baseUrl = normalizeBaseUrl(
    options.baseUrl ?? DEFAULT_ANTHROPIC_BASE_URL,
  );
  const timeoutMs = options.timeoutMs ?? DEFAULT_ANTHROPIC_TIMEOUT_MS;
  const maxTokens = options.maxTokens ?? DEFAULT_ANTHROPIC_MAX_TOKENS;
  const anthropicVersion =
    options.anthropicVersion ?? DEFAULT_ANTHROPIC_VERSION;

  const buildRequest = (
    input: ProviderExecutionRequest,
    config: ProviderApiKeyConfig,
  ): AnthropicProviderRequest => {
    const requestMessages = toAnthropicMessages(input.request.messages);

    return {
      url: `${baseUrl}/messages`,
      requestId: input.context.requestId,
      model: input.decision.selected.model,
      timeoutMs,
      headers: {
        "anthropic-version": anthropicVersion,
        "content-type": "application/json",
        "x-api-key": config.apiKey,
        "x-client-request-id": input.context.requestId,
      },
      body: {
        model: input.decision.selected.model,
        max_tokens: maxTokens,
        messages: requestMessages.messages,
        stream: false,
        ...(requestMessages.system ? { system: requestMessages.system } : {}),
      },
    };
  };

  const invoke = async (
    request: AnthropicProviderRequest,
  ): Promise<AnthropicProviderResponse> => {
    const abortController = new AbortController();
    const timeoutHandle = setTimeout(() => {
      abortController.abort();
    }, request.timeoutMs);
    const startedAt = Date.now();

    try {
      const response = await fetchImpl(request.url, {
        method: "POST",
        headers: request.headers,
        body: JSON.stringify(request.body),
        signal: abortController.signal,
      });
      const rawBody = await response.text();
      let body: unknown;
      let parseError: string | undefined;

      if (rawBody.length > 0) {
        try {
          body = JSON.parse(rawBody);
        } catch {
          parseError = "invalid_json";
        }
      }

      return {
        statusCode: response.status,
        ok: response.ok,
        body,
        rawBody: rawBody.length > 0 ? rawBody : undefined,
        parseError,
        latencyMs: Date.now() - startedAt,
        headers: buildResponseHeaders(response.headers),
      };
    } catch (error) {
      const latencyMs = Date.now() - startedAt;

      if (abortController.signal.aborted) {
        throw new AnthropicTransportError(
          "timeout",
          "Anthropic request timed out.",
          latencyMs,
          { cause: error },
        );
      }

      if (error instanceof Error && error.name === "AbortError") {
        throw new AnthropicTransportError(
          "timeout",
          "Anthropic request timed out.",
          latencyMs,
          { cause: error },
        );
      }

      if (error instanceof TypeError) {
        throw new AnthropicTransportError(
          "network",
          "Anthropic request failed before receiving a response.",
          latencyMs,
          { cause: error },
        );
      }

      throw new AnthropicTransportError(
        "unknown",
        "Unexpected Anthropic request failure.",
        latencyMs,
        { cause: error },
      );
    } finally {
      clearTimeout(timeoutHandle);
    }
  };

  const normalizeResponse = (
    response: AnthropicProviderResponse,
    input: ProviderExecutionRequest,
  ): ProviderExecutionResult => {
    if (!response.ok) {
      return normalizeHttpFailure(response, input);
    }

    const outputText = extractOutputText(response.body);
    const usableOutput = outputText?.trim().length ? outputText : undefined;
    const responseId = extractResponseId(response.body, response.headers);

    if (!usableOutput) {
      return {
        provider: ANTHROPIC_PROVIDER_NAME,
        model: input.decision.selected.model,
        requestStatus: "failed",
        latencyMs: response.latencyMs,
        responseId,
        error: {
          type: "provider_unavailable",
          code: "invalid_provider_response",
          message: "Anthropic returned a response without assistant content.",
          retryable: true,
          metadata: buildDiagnosticMetadata({
            headers: response.headers,
            rawBodyPreview:
              response.parseError || !response.body
                ? response.rawBody?.slice(0, 500)
                : undefined,
            statusCode: response.statusCode,
          }),
        },
      };
    }

    return {
      provider: ANTHROPIC_PROVIDER_NAME,
      model: input.decision.selected.model,
      requestStatus: "succeeded",
      outputText: usableOutput,
      finishReason: extractFinishReason(response.body),
      usage: extractUsageRecord(response.body, input.decision.selected.model),
      latencyMs: response.latencyMs,
      responseId,
    };
  };

  const normalizeError = (error: unknown): ProviderAdapterNormalizedError => {
    if (error instanceof AnthropicTransportError) {
      if (error.kind === "timeout") {
        return {
          type: "timeout",
          code: "provider_timeout",
          message: error.message,
          retryable: true,
          metadata: buildDiagnosticMetadata({
            timeoutMs,
          }),
        };
      }

      if (error.kind === "network") {
        return {
          type: "provider_unavailable",
          code: "provider_unavailable",
          message: error.message,
          retryable: true,
        };
      }
    }

    return {
      type: "unknown_provider_error",
      code: "unknown_provider_error",
      message:
        error instanceof Error
          ? error.message
          : "Unexpected Anthropic adapter failure.",
      retryable: false,
    };
  };

  return {
    provider: ANTHROPIC_PROVIDER_NAME,
    capabilities: {
      byok: true,
      streaming: false,
    },
    validateConfiguration: validateApiKeyConfiguration,
    buildRequest,
    invoke(request) {
      return invoke(request);
    },
    normalizeResponse,
    normalizeError,
    extractUsage(response) {
      const model =
        isRecord(response.body) && typeof response.body.model === "string"
          ? response.body.model
          : undefined;
      const usage = extractUsageRecord(response.body, model ?? "");

      if (!usage) {
        return undefined;
      }

      const { provider: _provider, model: _model, ...rest } = usage;
      return rest;
    },
    async execute(
      input: ProviderExecutionRequest,
      config: ProviderApiKeyConfig,
    ): Promise<ProviderExecutionResult> {
      const validation = validateApiKeyConfiguration(config);

      if (!validation.ok) {
        return {
          provider: ANTHROPIC_PROVIDER_NAME,
          model: input.decision.selected.model,
          requestStatus: "failed",
          error: {
            type: "invalid_request",
            code: "invalid_provider_configuration",
            message: validation.errors.join("; "),
            retryable: false,
          },
        };
      }

      const request = buildRequest(input, config);

      try {
        const response = await invoke(request);
        return normalizeResponse(response, input);
      } catch (error) {
        const normalizedError = normalizeError(error);

        return {
          provider: ANTHROPIC_PROVIDER_NAME,
          model: input.decision.selected.model,
          requestStatus: "failed",
          latencyMs:
            error instanceof AnthropicTransportError
              ? error.latencyMs
              : undefined,
          error: normalizedError,
        };
      }
    },
  };
}

export function createAnthropicAdapterPlaceholder() {
  return createAnthropicAdapter();
}
