import assert from "node:assert/strict";
import { test } from "node:test";

import type {
  ProviderExecutionRequest,
  ProviderExecutionResult,
  ProviderName,
} from "@neuralayer/core";
import { ProviderCredentialsResolutionError } from "@neuralayer/db";

import { createDatabaseChatProviderExecutor } from "./provider-executor";

function createProviderExecutionRequest(
  provider: ProviderName,
  model: string,
): ProviderExecutionRequest {
  return {
    request: {
      stream: false,
      messages: [
        {
          role: "user",
          content: "Run the provider executor.",
        },
      ],
      mode: "balanced",
      source: "api",
      requestId: "req_executor_test",
      projectId: "proj_executor_test",
      taskType: "general",
    },
    context: {
      workspaceId: "ws_executor_test",
      projectId: "proj_executor_test",
      mode: "balanced",
      source: "api",
      requestId: "req_executor_test",
      apiKeyId: "gak_executor_test",
      taskType: "general",
    },
    decision: {
      outcome: "selected",
      selected: {
        provider,
        model,
      },
      selectionReasonCode: "executor_test",
      selectionReasonText: "Selected by provider executor test.",
    },
  };
}

test("database-backed provider executor loads DB credentials and updates runtime posture", async () => {
  const postureUpdates: Array<Record<string, unknown>> = [];
  let adapterApiKey: string | null = null;
  const executor = createDatabaseChatProviderExecutor({
    getAdapter: () => ({
      provider: "openai",
      capabilities: {
        byok: true,
        streaming: false,
      },
      validateConfiguration() {
        return { ok: true };
      },
      buildRequest() {
        return {};
      },
      async invoke() {
        return {};
      },
      normalizeResponse() {
        throw new Error("not used in unit test");
      },
      normalizeError() {
        throw new Error("not used in unit test");
      },
      extractUsage() {
        return undefined;
      },
      async execute(_input, config) {
        adapterApiKey = config.apiKey;

        return {
          provider: "openai",
          model: "gpt-5-mini",
          requestStatus: "succeeded",
          outputText: "Executor output.",
        } satisfies ProviderExecutionResult;
      },
    }),
    loadProviderConfig: async () => ({
      providerAccountId: "provacc_executor_test",
      displayName: "OpenAI Executor Test",
      config: {
        apiKey: "sk-executor-test",
      },
    }),
    updateProviderPosture: async (input) => {
      postureUpdates.push(input as Record<string, unknown>);
      return null;
    },
  });

  const result = await executor.execute(
    createProviderExecutionRequest("openai", "gpt-5-mini"),
  );

  assert.equal(result.requestStatus, "succeeded");
  assert.equal(adapterApiKey, "sk-executor-test");
  assert.equal(postureUpdates.length, 1);
  assert.equal(postureUpdates[0]?.providerAccountId, "provacc_executor_test");
  assert.equal(postureUpdates[0]?.requestStatus, "succeeded");
  assert.equal(postureUpdates[0]?.modelId, "gpt-5-mini");
});

test("database-backed provider executor returns a configuration error when no usable credentials are configured", async () => {
  const postureUpdates: Array<Record<string, unknown>> = [];
  const executor = createDatabaseChatProviderExecutor({
    getAdapter: () => {
      throw new Error("adapter should not be resolved without credentials");
    },
    loadProviderConfig: async () => null,
    updateProviderPosture: async (input) => {
      postureUpdates.push(input as Record<string, unknown>);
      return null;
    },
  });

  const result = await executor.execute(
    createProviderExecutionRequest("anthropic", "claude-sonnet-4-20250514"),
  );

  assert.equal(result.requestStatus, "failed");
  assert.equal(result.error?.type, "auth_error");
  assert.equal(result.error?.code, "provider_configuration_missing");
  assert.equal(postureUpdates.length, 1);
  assert.equal(postureUpdates[0]?.workspaceId, "ws_executor_test");
  assert.equal(postureUpdates[0]?.provider, "anthropic");
  assert.equal(
    postureUpdates[0]?.errorMessage,
    "No usable provider credentials are configured for this workspace.",
  );
  assert.equal(postureUpdates[0]?.modelId, "claude-sonnet-4-20250514");
});

test("database-backed provider executor returns a safe invalid configuration error when stored credentials cannot be resolved", async () => {
  const postureUpdates: Array<Record<string, unknown>> = [];
  const executor = createDatabaseChatProviderExecutor({
    getAdapter: () => {
      throw new Error("adapter should not be resolved for invalid credentials");
    },
    loadProviderConfig: async () => {
      throw new ProviderCredentialsResolutionError({
        providerAccountId: "provacc_invalid_config",
      });
    },
    updateProviderPosture: async (input) => {
      postureUpdates.push(input as Record<string, unknown>);
      return null;
    },
  });

  const result = await executor.execute(
    createProviderExecutionRequest("openai", "gpt-5-mini"),
  );

  assert.equal(result.requestStatus, "failed");
  assert.equal(result.error?.type, "auth_error");
  assert.equal(result.error?.code, "invalid_provider_configuration");
  assert.equal(
    result.error?.message,
    "Configured provider credentials are invalid or unreadable for this workspace.",
  );
  assert.equal(postureUpdates.length, 1);
  assert.equal(postureUpdates[0]?.providerAccountId, "provacc_invalid_config");
  assert.equal(postureUpdates[0]?.errorCode, "invalid_provider_configuration");
  assert.equal(
    postureUpdates[0]?.errorMessage,
    "Configured provider credentials are invalid or unreadable for this workspace.",
  );
  assert.equal(postureUpdates[0]?.modelId, "gpt-5-mini");
});
