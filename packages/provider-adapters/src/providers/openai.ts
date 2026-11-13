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

const OPENAI_PROVIDER_NAME = "openai" as const;
const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_OPENAI_TIMEOUT_MS = 30_000;

const OPENAI_RATE_LIMIT_HEADER_NAMES = [
  "x-ratelimit-limit-requests",
  "x-ratelimit-limit-tokens",
  "x-ratelimit-remaining-requests",
  "x-ratelimit-remaining-tokens",
  "x-ratelimit-reset-requests",
  "x-ratelimit-reset-tokens",
] as const;

export interface OpenAIAdapterOptions {
  fetch?: typeof fetch;
  baseUrl?: string;
  timeoutMs?: number;
}

interface OpenAIChatCompletionRequestBody {
  model: string;
  messages: Message[];
  stream: false;
}

export interface OpenAIProviderRequest {
  body: OpenAIChatCompletionRequestBody;
  headers: Record<string, string>;
  model: string;
  requestId: string;
  timeoutMs: number;
  url: string;
}

interface OpenAIResponseHeaders {
  openaiProcessingMs?: number;
  rateLimitHeaders: Partial<
    Record<(typeof OPENAI_RATE_LIMIT_HEADER_NAMES)[number], string>
  >;
  requestId?: string;
}

interface OpenAIProviderResponse {
  body?: unknown;
  latencyMs: number;
  ok: boolean;
  parseError?: string;
  rawBody?: string;
  statusCode: number;
  headers: OpenAIResponseHeaders;
}

class OpenAITransportError extends Error {
  constructor(
    public readonly kind: "network" | "timeout" | "unknown",
    message: string,
    public readonly latencyMs: number,
    options: {
      cause?: unknown;
    } = {},
  ) {
    super(message, options);
    this.name = "OpenAITransportError";
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

function buildResponseHeaders(headers: Headers): OpenAIResponseHeaders {
  const requestId = headers.get("x-request-id") ?? undefined;
  const processingHeader = headers.get("openai-processing-ms");
  const processingMs =
    processingHeader && Number.isFinite(Number(processingHeader))
      ? Number(processingHeader)
      : undefined;
  const rateLimitHeaders: OpenAIResponseHeaders["rateLimitHeaders"] = {};

  for (const headerName of OPENAI_RATE_LIMIT_HEADER_NAMES) {
    const headerValue = headers.get(headerName);

    if (headerValue) {
      rateLimitHeaders[headerName] = headerValue;
    }
  }

  return {
    requestId,
    openaiProcessingMs: processingMs,
    rateLimitHeaders,
  };
}

function buildDiagnosticMetadata(
  options: {
    errorCode?: string;
    errorType?: string;
    headers?: OpenAIResponseHeaders;
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
    metadata.openai_error_type = options.errorType;
  }

  if (options.errorCode) {
    metadata.openai_error_code = options.errorCode;
  }

  if (options.headers?.requestId) {
    metadata["x-request-id"] = options.headers.requestId;
  }

  if (options.headers?.openaiProcessingMs !== undefined) {
    metadata["openai-processing-ms"] = options.headers.openaiProcessingMs;
  }

  for (const [headerName, headerValue] of Object.entries(
    options.headers?.rateLimitHeaders ?? {},
  )) {
    if (headerValue) {
      metadata[headerName] = headerValue;
    }
  }

  if (options.timeoutMs !== undefined) {
    metadata.timeout_ms = options.timeoutMs;
  }

  if (options.rawBodyPreview) {
    metadata.raw_body_preview = options.rawBodyPreview;
  }

  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

function extractErrorDetails(body: unknown) {
  const envelope = isRecord(body) ? body : undefined;
  const errorRecord = isRecord(envelope?.error) ? envelope.error : undefined;

  return {
    code: readString(errorRecord, "code"),
    message: readString(errorRecord, "message"),
    type: readString(errorRecord, "type"),
  };
}

function extractResponseId(body: unknown, headers: OpenAIResponseHeaders) {
  const record = isRecord(body) ? body : undefined;

  return (
    readString(record, "request_id") ??
    readString(record, "id") ??
    headers.requestId
  );
}

function extractOutputText(body: unknown): string | undefined {
  const record = isRecord(body) ? body : undefined;
  const choices = Array.isArray(record?.choices) ? record.choices : undefined;
  const firstChoice = choices?.[0];
  const choiceRecord = isRecord(firstChoice) ? firstChoice : undefined;
  const messageRecord = isRecord(choiceRecord?.message)
    ? choiceRecord.message
    : undefined;
  const content = messageRecord?.content;

  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return undefined;
  }

  const parts: string[] = [];

  for (const part of content) {
    if (!isRecord(part)) {
      continue;
    }

    if (part.type === "text" && typeof part.text === "string") {
      parts.push(part.text);
      continue;
    }

    if (part.type === "refusal" && typeof part.refusal === "string") {
      parts.push(part.refusal);
    }
  }

  return parts.length > 0 ? parts.join("") : undefined;
}

function extractFinishReason(body: unknown): string | undefined {
  const record = isRecord(body) ? body : undefined;
  const choices = Array.isArray(record?.choices) ? record.choices : undefined;
  const firstChoice = choices?.[0];
  const choiceRecord = isRecord(firstChoice) ? firstChoice : undefined;

  return readString(choiceRecord, "finish_reason");
}

function extractUsageRecord(
  body: unknown,
  model: string,
): UsageRecord | undefined {
  const record = isRecord(body) ? body : undefined;
  const usageRecord = isRecord(record?.usage) ? record.usage : undefined;
  const inputTokens = readNumber(usageRecord, "prompt_tokens");
  const outputTokens = readNumber(usageRecord, "completion_tokens");
  const totalTokens = readNumber(usageRecord, "total_tokens");

  if (
    inputTokens === undefined &&
    outputTokens === undefined &&
    totalTokens === undefined
  ) {
    return undefined;
  }

  return {
    provider: OPENAI_PROVIDER_NAME,
    model,
    inputTokens,
    outputTokens,
    totalTokens,
  };
}

function normalizeHttpFailure(
  response: OpenAIProviderResponse,
  input: ProviderExecutionRequest,
): ProviderExecutionResult {
  const errorDetails = extractErrorDetails(response.body);
  const rawBodyPreview =
    response.parseError || !response.body
      ? response.rawBody?.slice(0, 500)
      : undefined;
  const metadata = buildDiagnosticMetadata({
    errorCode: errorDetails.code,
    errorType: errorDetails.type,
    headers: response.headers,
    rawBodyPreview,
    statusCode: response.statusCode,
  });
  const baseResult = {
    provider: OPENAI_PROVIDER_NAME,
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
          "OpenAI rejected the provided authentication credentials.",
        retryable: false,
        metadata,
      },
    };
  }

  if (response.statusCode === 429) {
    if (errorDetails.code === "insufficient_quota") {
      return {
        ...baseResult,
        error: {
          type: "quota_exceeded",
          code: "provider_quota_exceeded",
          message: errorDetails.message ?? "OpenAI quota has been exceeded.",
          retryable: false,
          metadata,
        },
      };
    }

    return {
      ...baseResult,
      error: {
        type: "rate_limit",
        code: "provider_rate_limited",
        message: errorDetails.message ?? "OpenAI rate limited the request.",
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
        message: errorDetails.message ?? "OpenAI rejected the request payload.",
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
        message: errorDetails.message ?? "OpenAI is currently unavailable.",
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
        `OpenAI returned an unexpected HTTP ${response.statusCode} response.`,
      retryable: false,
      metadata,
    },
  };
}

export function createOpenAIAdapter(
  options: OpenAIAdapterOptions = {},
): ProviderAdapter<
  ProviderApiKeyConfig,
  OpenAIProviderRequest,
  OpenAIProviderResponse
> {
  const fetchImpl = options.fetch ?? fetch;
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? DEFAULT_OPENAI_BASE_URL);
  const timeoutMs = options.timeoutMs ?? DEFAULT_OPENAI_TIMEOUT_MS;

  const buildRequest = (
    input: ProviderExecutionRequest,
    config: ProviderApiKeyConfig,
  ): OpenAIProviderRequest => ({
    url: `${baseUrl}/chat/completions`,
    requestId: input.context.requestId,
    model: input.decision.selected.model,
    timeoutMs,
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
      "X-Client-Request-Id": input.context.requestId,
    },
    body: {
      model: input.decision.selected.model,
      messages: input.request.messages.map((message) => ({ ...message })),
      stream: false,
    },
  });

  const invoke = async (
    request: OpenAIProviderRequest,
  ): Promise<OpenAIProviderResponse> => {
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
        throw new OpenAITransportError(
          "timeout",
          "OpenAI request timed out.",
          latencyMs,
          { cause: error },
        );
      }

      if (error instanceof Error && error.name === "AbortError") {
        throw new OpenAITransportError(
          "timeout",
          "OpenAI request timed out.",
          latencyMs,
          { cause: error },
        );
      }

      if (error instanceof TypeError) {
        throw new OpenAITransportError(
          "network",
          "OpenAI request failed before receiving a response.",
          latencyMs,
          { cause: error },
        );
      }

      throw new OpenAITransportError(
        "unknown",
        "Unexpected OpenAI request failure.",
        latencyMs,
        { cause: error },
      );
    } finally {
      clearTimeout(timeoutHandle);
    }
  };

  const normalizeResponse = (
    response: OpenAIProviderResponse,
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
        provider: OPENAI_PROVIDER_NAME,
        model: input.decision.selected.model,
        requestStatus: "failed",
        latencyMs: response.latencyMs,
        responseId,
        error: {
          type: "provider_unavailable",
          code: "invalid_provider_response",
          message: "OpenAI returned a response without assistant content.",
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
      provider: OPENAI_PROVIDER_NAME,
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
    if (error instanceof OpenAITransportError) {
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
          : "Unexpected OpenAI adapter failure.",
      retryable: false,
    };
  };

  return {
    provider: OPENAI_PROVIDER_NAME,
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
          provider: OPENAI_PROVIDER_NAME,
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
          provider: OPENAI_PROVIDER_NAME,
          model: input.decision.selected.model,
          requestStatus: "failed",
          latencyMs:
            error instanceof OpenAITransportError ? error.latencyMs : undefined,
          error: normalizedError,
        };
      }
    },
  };
}
