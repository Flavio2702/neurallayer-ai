import assert from "node:assert/strict";
import { test } from "node:test";

import type { ProviderExecutionRequest, ProviderName } from "@neuralayer/core";

import {
  createAnthropicAdapter,
  createOpenAIAdapter,
  getProviderAdapter,
} from "./index";

function createProviderExecutionRequest(
  provider: ProviderName,
  model: string,
): ProviderExecutionRequest {
  return {
    request: {
      stream: false,
      messages: [
        {
          role: "system",
          content: "You are a precise assistant.",
        },
        {
          role: "user",
          content: "Summarize the contract.",
        },
      ],
      mode: "balanced",
      source: "api",
      requestId: "req_test_123",
      projectId: "proj_test",
      taskType: "general",
    },
    context: {
      workspaceId: "ws_test",
      projectId: "proj_test",
      mode: "balanced",
      source: "api",
      requestId: "req_test_123",
      apiKeyId: "gak_test",
      taskType: "general",
    },
    decision: {
      outcome: "selected",
      selected: {
        provider,
        model,
      },
      selectionReasonCode: "test_fixture",
      selectionReasonText: "Selected by the provider adapter test fixture.",
    },
  };
}

function createJsonResponse(
  body: unknown,
  options: {
    headers?: Record<string, string>;
    status?: number;
  } = {},
) {
  return new Response(JSON.stringify(body), {
    status: options.status ?? 200,
    headers: options.headers,
  });
}

test("getProviderAdapter returns the OpenAI adapter", () => {
  const adapter = getProviderAdapter("openai");

  assert.equal(adapter.provider, "openai");
});

test("getProviderAdapter returns the Anthropic adapter", () => {
  const adapter = getProviderAdapter("anthropic");

  assert.equal(adapter.provider, "anthropic");
});

test("provider adapters validate api key configuration", () => {
  const adapter = createOpenAIAdapter();

  assert.deepEqual(adapter.validateConfiguration({ apiKey: "" }), {
    ok: false,
    errors: ["Provider apiKey is required."],
  });
  assert.deepEqual(adapter.validateConfiguration({ apiKey: "test-key" }), {
    ok: true,
  });
});

test("openai adapter executes a successful non-streaming chat completion request", async () => {
  const fetchCalls: Array<{
    init: RequestInit | undefined;
    input: Parameters<typeof fetch>[0];
  }> = [];
  const adapter = createOpenAIAdapter({
    baseUrl: "https://example.openai.test/v1/",
    fetch: async (input, init) => {
      fetchCalls.push({ input, init });

      return createJsonResponse(
        {
          id: "chatcmpl_123",
          request_id: "req_openai_123",
          model: "gpt-5-mini",
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: [
                  {
                    type: "text",
                    text: "Structured ",
                  },
                  {
                    type: "text",
                    text: "summary.",
                  },
                ],
              },
              finish_reason: "stop",
            },
          ],
          usage: {
            prompt_tokens: 12,
            completion_tokens: 8,
            total_tokens: 20,
          },
        },
        {
          headers: {
            "content-type": "application/json",
            "openai-processing-ms": "321",
            "x-request-id": "req_header_123",
          },
        },
      );
    },
  });

  const result = await adapter.execute(
    createProviderExecutionRequest("openai", "gpt-5-mini"),
    { apiKey: "test-key" },
  );

  assert.equal(fetchCalls.length, 1);
  assert.equal(
    String(fetchCalls[0]?.input),
    "https://example.openai.test/v1/chat/completions",
  );

  const requestHeaders = new Headers(fetchCalls[0]?.init?.headers);
  const requestBody = JSON.parse(String(fetchCalls[0]?.init?.body));

  assert.equal(fetchCalls[0]?.init?.method, "POST");
  assert.equal(requestHeaders.get("authorization"), "Bearer test-key");
  assert.equal(requestHeaders.get("content-type"), "application/json");
  assert.equal(requestHeaders.get("x-client-request-id"), "req_test_123");
  assert.deepEqual(requestBody, {
    model: "gpt-5-mini",
    messages: [
      {
        role: "system",
        content: "You are a precise assistant.",
      },
      {
        role: "user",
        content: "Summarize the contract.",
      },
    ],
    stream: false,
  });

  assert.equal(result.provider, "openai");
  assert.equal(result.model, "gpt-5-mini");
  assert.equal(result.requestStatus, "succeeded");
  assert.equal(result.outputText, "Structured summary.");
  assert.equal(result.finishReason, "stop");
  assert.equal(result.responseId, "req_openai_123");
  assert.equal(typeof result.latencyMs, "number");
  assert.equal((result.latencyMs ?? -1) >= 0, true);
  assert.deepEqual(result.usage, {
    provider: "openai",
    model: "gpt-5-mini",
    inputTokens: 12,
    outputTokens: 8,
    totalTokens: 20,
  });
});

test("openai adapter maps auth failures to auth_error", async () => {
  const adapter = createOpenAIAdapter({
    fetch: async () =>
      createJsonResponse(
        {
          error: {
            message: "Incorrect API key provided.",
            type: "invalid_request_error",
            code: "invalid_api_key",
          },
        },
        {
          status: 401,
          headers: {
            "x-request-id": "req_auth_123",
          },
        },
      ),
  });

  const result = await adapter.execute(
    createProviderExecutionRequest("openai", "gpt-5-mini"),
    { apiKey: "test-key" },
  );

  assert.equal(result.requestStatus, "failed");
  assert.equal(result.error?.type, "auth_error");
  assert.equal(result.error?.code, "provider_auth_failed");
  assert.equal(result.error?.message, "Incorrect API key provided.");
  assert.equal(result.error?.retryable, false);
  assert.deepEqual(result.error?.metadata, {
    status_code: 401,
    openai_error_type: "invalid_request_error",
    openai_error_code: "invalid_api_key",
    "x-request-id": "req_auth_123",
  });
});

test("openai adapter maps rate limiting to rate_limit and preserves diagnostics", async () => {
  const adapter = createOpenAIAdapter({
    fetch: async () =>
      createJsonResponse(
        {
          error: {
            message: "Rate limit reached for requests.",
            type: "rate_limit_error",
            code: "rate_limit_exceeded",
          },
        },
        {
          status: 429,
          headers: {
            "x-ratelimit-limit-requests": "5000",
            "x-ratelimit-remaining-requests": "0",
            "x-ratelimit-reset-requests": "12ms",
            "x-request-id": "req_rate_123",
          },
        },
      ),
  });

  const result = await adapter.execute(
    createProviderExecutionRequest("openai", "gpt-5-mini"),
    { apiKey: "test-key" },
  );

  assert.equal(result.requestStatus, "failed");
  assert.equal(result.error?.type, "rate_limit");
  assert.equal(result.error?.code, "provider_rate_limited");
  assert.equal(result.error?.message, "Rate limit reached for requests.");
  assert.equal(result.error?.retryable, true);
  assert.deepEqual(result.error?.metadata, {
    status_code: 429,
    openai_error_type: "rate_limit_error",
    openai_error_code: "rate_limit_exceeded",
    "x-request-id": "req_rate_123",
    "x-ratelimit-limit-requests": "5000",
    "x-ratelimit-remaining-requests": "0",
    "x-ratelimit-reset-requests": "12ms",
  });
});

test("openai adapter maps request timeouts to timeout", async () => {
  const adapter = createOpenAIAdapter({
    timeoutMs: 5,
    fetch: async (_input, init) =>
      new Promise((_resolve, reject) => {
        const abortError = Object.assign(
          new Error("The operation was aborted."),
          {
            name: "AbortError",
          },
        );

        if (init?.signal?.aborted) {
          reject(abortError);
          return;
        }

        init?.signal?.addEventListener(
          "abort",
          () => {
            reject(abortError);
          },
          { once: true },
        );
      }),
  });

  const result = await adapter.execute(
    createProviderExecutionRequest("openai", "gpt-5-mini"),
    { apiKey: "test-key" },
  );

  assert.equal(result.requestStatus, "failed");
  assert.equal(result.error?.type, "timeout");
  assert.equal(result.error?.code, "provider_timeout");
  assert.equal(result.error?.message, "OpenAI request timed out.");
  assert.equal(result.error?.retryable, true);
  assert.deepEqual(result.error?.metadata, {
    timeout_ms: 5,
  });
  assert.equal(typeof result.latencyMs, "number");
  assert.equal((result.latencyMs ?? -1) >= 0, true);
});

test("openai adapter maps generic upstream failures to provider_unavailable", async () => {
  const adapter = createOpenAIAdapter({
    fetch: async () =>
      createJsonResponse(
        {
          error: {
            message:
              "The engine is currently overloaded, please try again later.",
            type: "server_error",
            code: "server_error",
          },
        },
        {
          status: 503,
          headers: {
            "x-request-id": "req_upstream_123",
          },
        },
      ),
  });

  const result = await adapter.execute(
    createProviderExecutionRequest("openai", "gpt-5-mini"),
    { apiKey: "test-key" },
  );

  assert.equal(result.requestStatus, "failed");
  assert.equal(result.error?.type, "provider_unavailable");
  assert.equal(result.error?.code, "provider_unavailable");
  assert.equal(
    result.error?.message,
    "The engine is currently overloaded, please try again later.",
  );
  assert.equal(result.error?.retryable, true);
  assert.deepEqual(result.error?.metadata, {
    status_code: 503,
    openai_error_type: "server_error",
    openai_error_code: "server_error",
    "x-request-id": "req_upstream_123",
  });
});

test("openai adapter treats unusable success payloads as provider_unavailable", async () => {
  const adapter = createOpenAIAdapter({
    fetch: async () =>
      createJsonResponse({
        id: "chatcmpl_123",
        choices: [],
      }),
  });

  const result = await adapter.execute(
    createProviderExecutionRequest("openai", "gpt-5-mini"),
    { apiKey: "test-key" },
  );

  assert.equal(result.requestStatus, "failed");
  assert.equal(result.error?.type, "provider_unavailable");
  assert.equal(result.error?.code, "invalid_provider_response");
  assert.equal(
    result.error?.message,
    "OpenAI returned a response without assistant content.",
  );
});

test("anthropic adapter executes a successful non-streaming messages request", async () => {
  const fetchCalls: Array<{
    init: RequestInit | undefined;
    input: Parameters<typeof fetch>[0];
  }> = [];
  const adapter = createAnthropicAdapter({
    baseUrl: "https://example.anthropic.test/v1/",
    fetch: async (input, init) => {
      fetchCalls.push({ input, init });

      return createJsonResponse(
        {
          id: "msg_123",
          model: "claude-sonnet-4-20250514",
          content: [
            {
              type: "text",
              text: "Anthropic summary.",
            },
          ],
          stop_reason: "end_turn",
          usage: {
            input_tokens: 11,
            output_tokens: 7,
          },
        },
        {
          headers: {
            "content-type": "application/json",
            "request-id": "req_anthropic_123",
          },
        },
      );
    },
  });

  const result = await adapter.execute(
    createProviderExecutionRequest("anthropic", "claude-sonnet-4-20250514"),
    { apiKey: "anthropic-test-key" },
  );

  assert.equal(fetchCalls.length, 1);
  assert.equal(
    String(fetchCalls[0]?.input),
    "https://example.anthropic.test/v1/messages",
  );

  const requestHeaders = new Headers(fetchCalls[0]?.init?.headers);
  const requestBody = JSON.parse(String(fetchCalls[0]?.init?.body));

  assert.equal(fetchCalls[0]?.init?.method, "POST");
  assert.equal(requestHeaders.get("x-api-key"), "anthropic-test-key");
  assert.equal(requestHeaders.get("anthropic-version"), "2023-06-01");
  assert.equal(requestHeaders.get("x-client-request-id"), "req_test_123");
  assert.deepEqual(requestBody, {
    model: "claude-sonnet-4-20250514",
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Summarize the contract.",
          },
        ],
      },
    ],
    stream: false,
    system: "You are a precise assistant.",
  });

  assert.equal(result.provider, "anthropic");
  assert.equal(result.model, "claude-sonnet-4-20250514");
  assert.equal(result.requestStatus, "succeeded");
  assert.equal(result.outputText, "Anthropic summary.");
  assert.equal(result.finishReason, "end_turn");
  assert.equal(result.responseId, "msg_123");
  assert.deepEqual(result.usage, {
    provider: "anthropic",
    model: "claude-sonnet-4-20250514",
    inputTokens: 11,
    outputTokens: 7,
    totalTokens: 18,
  });
});

test("anthropic adapter maps auth failures to auth_error", async () => {
  const adapter = createAnthropicAdapter({
    fetch: async () =>
      createJsonResponse(
        {
          type: "error",
          error: {
            type: "authentication_error",
            message: "invalid x-api-key",
          },
        },
        {
          status: 401,
          headers: {
            "request-id": "req_anthropic_auth_123",
          },
        },
      ),
  });

  const result = await adapter.execute(
    createProviderExecutionRequest("anthropic", "claude-sonnet-4-20250514"),
    { apiKey: "anthropic-test-key" },
  );

  assert.equal(result.requestStatus, "failed");
  assert.equal(result.error?.type, "auth_error");
  assert.equal(result.error?.code, "provider_auth_failed");
  assert.equal(result.error?.message, "invalid x-api-key");
  assert.equal(result.error?.retryable, false);
  assert.deepEqual(result.error?.metadata, {
    status_code: 401,
    anthropic_error_type: "authentication_error",
    "request-id": "req_anthropic_auth_123",
  });
});
