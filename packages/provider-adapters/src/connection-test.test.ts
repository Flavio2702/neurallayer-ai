import assert from "node:assert/strict";
import { test } from "node:test";
import { createProviderConnectionTestRunner } from "./connection-test";
import { createAnthropicAdapter } from "./providers/anthropic";
import { createOpenAIAdapter } from "./providers/openai";

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

test("provider connection test runner executes an OpenAI connection test through the adapter", async () => {
  const fetchCalls: Array<{
    init: RequestInit | undefined;
    input: Parameters<typeof fetch>[0];
  }> = [];
  const runner = createProviderConnectionTestRunner({
    getAdapter: () =>
      createOpenAIAdapter({
        baseUrl: "https://example.openai.test/v1/",
        fetch: async (input, init) => {
          fetchCalls.push({ input, init });

          return createJsonResponse({
            id: "chatcmpl_provider_test_openai",
            request_id: "req_provider_test_openai",
            model: "gpt-5-mini",
            choices: [
              {
                index: 0,
                message: {
                  role: "assistant",
                  content: [{ type: "text", text: "ok" }],
                },
                finish_reason: "stop",
              },
            ],
          });
        },
      }),
  });

  const result = await runner.run({
    provider: "openai",
    model: "gpt-5-mini",
    requestId: "req_provider_test_openai",
    config: {
      apiKey: "test-openai-key",
    },
  });

  assert.equal(fetchCalls.length, 1);
  assert.equal(
    String(fetchCalls[0]?.input),
    "https://example.openai.test/v1/chat/completions",
  );

  const requestHeaders = new Headers(fetchCalls[0]?.init?.headers);
  const requestBody = JSON.parse(String(fetchCalls[0]?.init?.body));

  assert.equal(requestHeaders.get("authorization"), "Bearer test-openai-key");
  assert.equal(
    requestHeaders.get("x-client-request-id"),
    "req_provider_test_openai",
  );
  assert.deepEqual(requestBody, {
    model: "gpt-5-mini",
    messages: [
      {
        role: "user",
        content: "Reply with the single word ok.",
      },
    ],
    stream: false,
  });
  assert.equal(result.requestStatus, "succeeded");
  assert.equal(result.outputText, "ok");
});

test("provider connection test runner executes an Anthropic connection test through the adapter", async () => {
  const fetchCalls: Array<{
    init: RequestInit | undefined;
    input: Parameters<typeof fetch>[0];
  }> = [];
  const runner = createProviderConnectionTestRunner({
    getAdapter: () =>
      createAnthropicAdapter({
        baseUrl: "https://example.anthropic.test/v1/",
        fetch: async (input, init) => {
          fetchCalls.push({ input, init });

          return createJsonResponse(
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
                "request-id": "req_provider_test_anthropic",
              },
            },
          );
        },
      }),
  });

  const result = await runner.run({
    provider: "anthropic",
    model: "claude-sonnet-4-20250514",
    requestId: "req_provider_test_anthropic",
    config: {
      apiKey: "test-anthropic-key",
    },
  });

  assert.equal(fetchCalls.length, 1);
  assert.equal(
    String(fetchCalls[0]?.input),
    "https://example.anthropic.test/v1/messages",
  );

  const requestHeaders = new Headers(fetchCalls[0]?.init?.headers);
  const requestBody = JSON.parse(String(fetchCalls[0]?.init?.body));

  assert.equal(requestHeaders.get("x-api-key"), "test-anthropic-key");
  assert.equal(
    requestHeaders.get("x-client-request-id"),
    "req_provider_test_anthropic",
  );
  assert.deepEqual(requestBody, {
    model: "claude-sonnet-4-20250514",
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Reply with the single word ok.",
          },
        ],
      },
    ],
    stream: false,
  });
  assert.equal(result.requestStatus, "failed");
  assert.equal(result.error?.type, "auth_error");
  assert.equal(result.error?.code, "provider_auth_failed");
});

test("provider connection test runner calls adapter.execute instead of bypassing the adapter contract", async () => {
  let executeCallCount = 0;
  const runner = createProviderConnectionTestRunner({
    getAdapter: () => ({
      provider: "openai",
      capabilities: {
        byok: true,
        streaming: false,
      },
      validateConfiguration() {
        throw new Error("validateConfiguration should not be called directly");
      },
      buildRequest() {
        throw new Error("buildRequest should not be called directly");
      },
      async invoke() {
        throw new Error("invoke should not be called directly");
      },
      normalizeResponse() {
        throw new Error("normalizeResponse should not be called directly");
      },
      normalizeError() {
        throw new Error("normalizeError should not be called directly");
      },
      extractUsage() {
        return undefined;
      },
      async execute(input, config) {
        executeCallCount += 1;

        assert.equal(input.request.source, "dashboard");
        assert.equal(input.request.messages.length, 1);
        assert.equal(input.decision.selected.model, "gpt-5-mini");
        assert.equal(config.apiKey, "adapter-execute-test");

        return {
          provider: "openai",
          model: "gpt-5-mini",
          requestStatus: "succeeded",
          outputText: "ok",
        };
      },
    }),
  });

  const result = await runner.run({
    provider: "openai",
    model: "gpt-5-mini",
    requestId: "req_provider_test_execute",
    config: {
      apiKey: "adapter-execute-test",
    },
  });

  assert.equal(executeCallCount, 1);
  assert.equal(result.requestStatus, "succeeded");
});
