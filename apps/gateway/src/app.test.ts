import assert from "node:assert/strict";
import { Writable } from "node:stream";
import { test } from "node:test";
import {
  type ErrorType,
  type GatewaySuccessResponse,
  MODE_VALUES,
  TASK_TYPE_VALUES,
} from "@neuralayer/core";

import { ProviderCredentialsResolutionError } from "@neuralayer/db";
import Fastify from "fastify";

import { createGatewayApp } from "./app";
import { createForbiddenError, createGatewayApiError } from "./lib/api-error";
import type { GatewayAuthService } from "./modules/auth/context";
import { createNoopChatPersistence } from "./modules/chat/persistence";
import { createDatabaseChatProviderExecutor } from "./modules/chat/provider-executor";
import type { ChatCompletionsRuntime } from "./modules/chat/runtime";
import { createChatCompletionsRuntime } from "./modules/chat/runtime";
import { gatewayAuthPlugin } from "./plugins/gateway-auth";

interface CapturedLogEntry {
  level: number;
  msg: string;
  [key: string]: unknown;
}

function createTestAuthService(): GatewayAuthService {
  return {
    async authenticateApiKey(apiKey) {
      switch (apiKey) {
        case "valid-workspace-key":
          return {
            workspaceId: "ws_test",
            apiKeyId: "gak_workspace",
          };
        case "valid-project-key":
          return {
            workspaceId: "ws_test",
            apiKeyId: "gak_project",
            defaultProjectId: "proj_default",
          };
        case "revoked-key":
          throw createForbiddenError(
            "revoked_api_key",
            "The provided API key has been revoked.",
          );
        case "expired-key":
          throw createForbiddenError(
            "expired_api_key",
            "The provided API key has expired.",
          );
        default:
          return null;
      }
    },
    async loadMeContext(authContext) {
      return {
        workspace: {
          id: authContext.workspaceId,
          name: "Test Workspace",
        },
        project: authContext.defaultProjectId
          ? {
              id: authContext.defaultProjectId,
              name: "Default Project",
            }
          : null,
        availableModes: MODE_VALUES,
        availableTaskTypes: TASK_TYPE_VALUES,
        providersConfigured: ["openai", "anthropic"],
      };
    },
    async resolveProject(authContext, requestedProjectId) {
      const projectId = requestedProjectId ?? authContext.defaultProjectId;

      if (!projectId) {
        return null;
      }

      if (!["proj_default", "proj_header", "proj_body"].includes(projectId)) {
        return null;
      }

      return {
        id: projectId,
        name:
          projectId === "proj_default"
            ? "Default Project"
            : "Requested Project",
      };
    },
  };
}

function assertGatewayError(
  response: Awaited<ReturnType<ReturnType<typeof createGatewayApp>["inject"]>>,
  statusCode: number,
  type: ErrorType,
  code: string,
) {
  assert.equal(response.statusCode, statusCode);

  const body = response.json();

  assert.equal(body.error.type, type);
  assert.equal(body.error.code, code);
  assert.equal(body.error.request_id, response.headers["x-request-id"]);
}

function createLogCapture() {
  const entries: CapturedLogEntry[] = [];
  let buffer = "";

  const stream = new Writable({
    write(chunk, _encoding, callback) {
      buffer += chunk.toString();

      while (buffer.includes("\n")) {
        const newlineIndex = buffer.indexOf("\n");
        const line = buffer.slice(0, newlineIndex).trim();

        buffer = buffer.slice(newlineIndex + 1);

        if (line.length > 0) {
          entries.push(JSON.parse(line) as CapturedLogEntry);
        }
      }

      callback();
    },
  });

  return {
    entries,
    stream,
  };
}

function createGatewayAppWithCapturedLogs(
  options: {
    authService?: GatewayAuthService;
    chatRuntime?: ChatCompletionsRuntime;
  } = {},
) {
  const logCapture = createLogCapture();
  const app = createGatewayApp({
    authService: options.authService ?? createTestAuthService(),
    chatRuntime: options.chatRuntime,
    logger: {
      level: "info",
      stream: logCapture.stream,
    },
  });

  return {
    app,
    logs: logCapture.entries,
  };
}

function getEventMessages(logs: CapturedLogEntry[]) {
  return logs.map((entry) => entry.msg);
}

function getFirstLogByMessage(logs: CapturedLogEntry[], message: string) {
  return logs.find((entry) => entry.msg === message);
}

function createChatCompletionSuccessResponse(): GatewaySuccessResponse {
  return {
    id: "req_runtime_success",
    object: "chat.completion",
    created: 1_774_016_400,
    model: "gpt-5-mini",
    provider: "openai",
    mode: "budget",
    task_type: "debugging",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: "Structured runtime response.",
        },
        finish_reason: "stop",
      },
    ],
    usage: {
      input_tokens: 12,
      output_tokens: 8,
      total_tokens: 20,
    },
    meta: {
      workspace_id: "ws_test",
      project_id: "proj_header",
      latency_ms: 22,
      selection_reason: {
        code: "best_score_for_mode",
        text: "Selected openai/gpt-5-mini because it had the best budget score across policy-eligible candidates.",
      },
      warnings: [
        {
          code: "benchmark_snapshot_stale",
          message:
            "The latest local benchmark snapshot is older than 7 days, so routing continued with a staleness warning.",
        },
      ],
      cost_usd: 0.42,
      cost_source: "estimated",
    },
  };
}

test("gateway auth plugin decorates protected requests with the minimal context", async (t) => {
  const app = Fastify();
  const authService = createTestAuthService();

  t.after(async () => {
    await app.close();
  });

  await gatewayAuthPlugin(app, { authService });
  app.get("/protected-context", async (request) => request.gatewayAuth);

  const response = await app.inject({
    method: "GET",
    url: "/protected-context",
    headers: {
      authorization: "Bearer valid-project-key",
    },
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    workspaceId: "ws_test",
    apiKeyId: "gak_project",
    defaultProjectId: "proj_default",
  });
});

test("GET /v1/models rejects requests without Authorization", async (t) => {
  const { app, logs } = createGatewayAppWithCapturedLogs();

  t.after(async () => {
    await app.close();
  });

  const response = await app.inject({
    method: "GET",
    url: "/v1/models",
  });

  assertGatewayError(
    response,
    401,
    "auth_error",
    "missing_authorization_header",
  );
  assert.deepEqual(getEventMessages(logs), [
    "request received",
    "auth result",
    "error raised",
  ]);

  const authLog = getFirstLogByMessage(logs, "auth result");
  const errorLog = getFirstLogByMessage(logs, "error raised");

  assert.equal(authLog?.statusCode, 401);
  assert.equal(authLog?.errorType, "auth_error");
  assert.equal(authLog?.errorCode, "missing_authorization_header");
  assert.equal(errorLog?.statusCode, 401);
  assert.equal(errorLog?.errorType, "auth_error");
  assert.equal(errorLog?.errorCode, "missing_authorization_header");
});

test("GET /v1/models rejects malformed Bearer headers", async (t) => {
  const app = createGatewayApp({
    authService: createTestAuthService(),
  });

  t.after(async () => {
    await app.close();
  });

  const response = await app.inject({
    method: "GET",
    url: "/v1/models",
    headers: {
      authorization: "Token invalid-project-key",
    },
  });

  assertGatewayError(response, 401, "auth_error", "invalid_bearer_token");
});

test("GET /v1/models rejects unknown API keys", async (t) => {
  const app = createGatewayApp({
    authService: createTestAuthService(),
  });

  t.after(async () => {
    await app.close();
  });

  const response = await app.inject({
    method: "GET",
    url: "/v1/models",
    headers: {
      authorization: "Bearer unknown-key",
    },
  });

  assertGatewayError(response, 401, "auth_error", "invalid_api_key");
});

test("GET /v1/models rejects revoked API keys", async (t) => {
  const app = createGatewayApp({
    authService: createTestAuthService(),
  });

  t.after(async () => {
    await app.close();
  });

  const response = await app.inject({
    method: "GET",
    url: "/v1/models",
    headers: {
      authorization: "Bearer revoked-key",
    },
  });

  assertGatewayError(response, 403, "forbidden", "revoked_api_key");
});

test("GET /v1/models rejects expired API keys", async (t) => {
  const app = createGatewayApp({
    authService: createTestAuthService(),
  });

  t.after(async () => {
    await app.close();
  });

  const response = await app.inject({
    method: "GET",
    url: "/v1/models",
    headers: {
      authorization: "Bearer expired-key",
    },
  });

  assertGatewayError(response, 403, "forbidden", "expired_api_key");
});

test("GET /v1/me returns project null for workspace-level API keys", async (t) => {
  const { app, logs } = createGatewayAppWithCapturedLogs();

  t.after(async () => {
    await app.close();
  });

  const response = await app.inject({
    method: "GET",
    url: "/v1/me",
    headers: {
      authorization: "Bearer valid-workspace-key",
    },
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    workspace: {
      id: "ws_test",
      name: "Test Workspace",
    },
    project: null,
    available_modes: [...MODE_VALUES],
    available_task_types: [...TASK_TYPE_VALUES],
    providers_configured: ["openai", "anthropic"],
  });
  assert.deepEqual(getEventMessages(logs), [
    "request received",
    "auth result",
    "route invoked",
  ]);

  const authLog = getFirstLogByMessage(logs, "auth result");
  const routeLog = getFirstLogByMessage(logs, "route invoked");

  assert.equal(authLog?.workspaceId, "ws_test");
  assert.equal(authLog?.apiKeyId, "gak_workspace");
  assert.equal(routeLog?.routeId, "v1.me");
  assert.equal(routeLog?.workspaceId, "ws_test");
  assert.equal(routeLog?.projectId, undefined);
});

test("POST /v1/chat/completions rejects requests when no project can be resolved", async (t) => {
  const app = createGatewayApp({
    authService: createTestAuthService(),
  });

  t.after(async () => {
    await app.close();
  });

  const response = await app.inject({
    method: "POST",
    url: "/v1/chat/completions",
    headers: {
      authorization: "Bearer valid-workspace-key",
    },
    payload: {
      messages: [
        {
          role: "user",
          content: "Review this function.",
        },
      ],
    },
  });

  assertGatewayError(response, 400, "invalid_request", "missing_project_id");
  assert.equal(
    response.json().error.message,
    "No valid project context could be resolved for this request.",
  );
});

test("POST /v1/chat/completions rejects an invalid project_id in the request body before runtime execution", async (t) => {
  let runtimeCalls = 0;
  const chatRuntime: ChatCompletionsRuntime = {
    async execute() {
      runtimeCalls += 1;
      return createChatCompletionSuccessResponse();
    },
  };
  const app = createGatewayApp({
    authService: createTestAuthService(),
    chatRuntime,
  });

  t.after(async () => {
    await app.close();
  });

  const response = await app.inject({
    method: "POST",
    url: "/v1/chat/completions",
    headers: {
      authorization: "Bearer valid-project-key",
    },
    payload: {
      messages: [
        {
          role: "user",
          content: "Reject the invalid project id before the runtime starts.",
        },
      ],
      project_id: "",
    },
  });

  assertGatewayError(response, 400, "invalid_request", "missing_project_id");
  assert.equal(
    response.json().error.message,
    "The provided project ID is invalid.",
  );
  assert.equal(runtimeCalls, 0);
});

test("POST /v1/chat/completions rejects unsupported streaming before runtime execution", async (t) => {
  let runtimeCalls = 0;
  const chatRuntime: ChatCompletionsRuntime = {
    async execute() {
      runtimeCalls += 1;
      return createChatCompletionSuccessResponse();
    },
  };
  const app = createGatewayApp({
    authService: createTestAuthService(),
    chatRuntime,
  });

  t.after(async () => {
    await app.close();
  });

  const response = await app.inject({
    method: "POST",
    url: "/v1/chat/completions",
    headers: {
      authorization: "Bearer valid-project-key",
    },
    payload: {
      messages: [
        {
          role: "user",
          content: "Stream this response.",
        },
      ],
      stream: true,
    },
  });

  assertGatewayError(response, 501, "not_supported", "streaming_not_enabled");
  assert.equal(runtimeCalls, 0);
});

test("POST /v1/chat/completions delegates non-streaming requests to the injected runtime", async (t) => {
  let runtimeCalls = 0;
  const chatRuntime: ChatCompletionsRuntime = {
    async execute(input) {
      runtimeCalls += 1;
      assert.equal(input.requestId.length > 0, true);
      assert.equal(input.authContext.workspaceId, "ws_test");
      assert.equal(input.authContext.apiKeyId, "gak_workspace");
      assert.equal(input.effectiveRequest.projectId, "proj_header");
      assert.equal(input.effectiveRequest.mode, "budget");
      assert.equal(input.effectiveRequest.taskType, "debugging");
      assert.equal(input.effectiveRequest.stream, false);

      return createChatCompletionSuccessResponse();
    },
  };
  const app = createGatewayApp({
    authService: createTestAuthService(),
    chatRuntime,
  });

  t.after(async () => {
    await app.close();
  });

  const response = await app.inject({
    method: "POST",
    url: "/v1/chat/completions",
    headers: {
      authorization: "Bearer valid-workspace-key",
      "x-neuralayer-project-id": "proj_header",
      "x-neuralayer-mode": "budget",
      "x-neuralayer-task-type": "debugging",
    },
    payload: {
      messages: [
        {
          role: "user",
          content: "Debug this function.",
        },
      ],
    },
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), createChatCompletionSuccessResponse());
  assert.equal(runtimeCalls, 1);
});

test("POST /v1/chat/completions returns the runtime-built playground metadata on success", async (t) => {
  const requestId = "req_http_runtime_success";
  const chatRuntime = createChatCompletionsRuntime({
    authService: createTestAuthService(),
    router: {
      async route() {
        return {
          outcome: "selected" as const,
          selected: {
            provider: "anthropic",
            model: "claude-sonnet-4-20250514",
          },
          selectionReasonCode: "best_score_for_mode",
          selectionReasonText:
            "Selected anthropic/claude-sonnet-4-20250514 because it had the best balanced score across policy-eligible candidates.",
          warnings: [
            {
              code: "benchmark_snapshot_stale",
              message:
                "The latest local benchmark snapshot is older than 7 days, so routing continued with a staleness warning.",
              metadata: {
                age_hours: 240,
              },
            },
          ],
        };
      },
    },
    providerExecutor: {
      async execute() {
        return {
          provider: "anthropic" as const,
          model: "claude-sonnet-4-20250514",
          requestStatus: "succeeded" as const,
          outputText: "Anthropic routed response.",
          finishReason: "end_turn",
          responseId: "anthropic-success-http",
          latencyMs: 33,
          usage: {
            provider: "anthropic",
            model: "claude-sonnet-4-20250514",
            inputTokens: 120,
            outputTokens: 48,
            totalTokens: 168,
            costUsd: 0.31,
          },
        };
      },
    },
    persistence: createNoopChatPersistence(),
  });
  const app = createGatewayApp({
    authService: createTestAuthService(),
    chatRuntime,
  });

  t.after(async () => {
    await app.close();
  });

  const response = await app.inject({
    method: "POST",
    url: "/v1/chat/completions",
    headers: {
      authorization: "Bearer valid-workspace-key",
      "x-neuralayer-project-id": "proj_header",
      "x-request-id": requestId,
    },
    payload: {
      messages: [
        {
          role: "user",
          content: "Return the runtime-built playground metadata.",
        },
      ],
      mode: "balanced",
    },
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    id: requestId,
    object: "chat.completion",
    created: response.json().created,
    model: "claude-sonnet-4-20250514",
    provider: "anthropic",
    mode: "balanced",
    task_type: "general",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: "Anthropic routed response.",
        },
        finish_reason: "end_turn",
      },
    ],
    usage: {
      input_tokens: 120,
      output_tokens: 48,
      total_tokens: 168,
    },
    meta: {
      workspace_id: "ws_test",
      project_id: "proj_header",
      latency_ms: 33,
      selection_reason: {
        code: "best_score_for_mode",
        text: "Selected anthropic/claude-sonnet-4-20250514 because it had the best balanced score across policy-eligible candidates.",
      },
      warnings: [
        {
          code: "benchmark_snapshot_stale",
          message:
            "The latest local benchmark snapshot is older than 7 days, so routing continued with a staleness warning.",
        },
      ],
      cost_usd: 0.31,
      cost_source: "provider_reported",
    },
  });
});

test("POST /v1/chat/completions returns normalized errors from the injected runtime", async (t) => {
  const chatRuntime: ChatCompletionsRuntime = {
    async execute() {
      throw createGatewayApiError({
        statusCode: 503,
        type: "provider_unavailable",
        code: "provider_runtime_not_ready",
        message: "Provider runtime is not ready for this gateway instance.",
      });
    },
  };
  const app = createGatewayApp({
    authService: createTestAuthService(),
    chatRuntime,
  });

  t.after(async () => {
    await app.close();
  });

  const response = await app.inject({
    method: "POST",
    url: "/v1/chat/completions",
    headers: {
      authorization: "Bearer valid-project-key",
    },
    payload: {
      messages: [
        {
          role: "user",
          content: "Review this function.",
        },
      ],
    },
  });

  assertGatewayError(
    response,
    503,
    "provider_unavailable",
    "provider_runtime_not_ready",
  );
});

test("POST /v1/chat/completions exposes workspace budget exceeded as the public blocked code", async (t) => {
  const chatRuntime = createChatCompletionsRuntime({
    authService: createTestAuthService(),
    router: {
      async route() {
        return {
          outcome: "blocked" as const,
          selectionReasonCode: "policy_blocked_budget_cap",
          selectionReasonText:
            "Blocked because the workspace monthly gateway-recorded budget cap has already been reached.",
        };
      },
    },
    providerExecutor: {
      async execute() {
        throw new Error(
          "Provider execution should not start for blocked routing.",
        );
      },
    },
    persistence: createNoopChatPersistence(),
  });
  const app = createGatewayApp({
    authService: createTestAuthService(),
    chatRuntime,
  });

  t.after(async () => {
    await app.close();
  });

  const response = await app.inject({
    method: "POST",
    url: "/v1/chat/completions",
    headers: {
      authorization: "Bearer valid-project-key",
    },
    payload: {
      messages: [
        {
          role: "user",
          content: "Trigger the budget block path.",
        },
      ],
    },
  });

  assertGatewayError(
    response,
    403,
    "policy_blocked",
    "workspace_budget_exceeded",
  );
  assert.equal(
    response.json().error.message,
    "Blocked because the workspace monthly gateway-recorded budget cap has already been reached.",
  );
});

test("POST /v1/chat/completions exposes a concise public-safe message for non-budget policy blocks", async (t) => {
  const chatRuntime = createChatCompletionsRuntime({
    authService: createTestAuthService(),
    router: {
      async route() {
        return {
          outcome: "blocked" as const,
          selectionReasonCode: "policy_blocked_no_eligible_candidate",
          selectionReasonText:
            "Blocked because policy rules left no eligible provider/model candidate for this request.",
        };
      },
    },
    providerExecutor: {
      async execute() {
        throw new Error(
          "Provider execution should not start for blocked routing.",
        );
      },
    },
    persistence: createNoopChatPersistence(),
  });
  const app = createGatewayApp({
    authService: createTestAuthService(),
    chatRuntime,
  });

  t.after(async () => {
    await app.close();
  });

  const response = await app.inject({
    method: "POST",
    url: "/v1/chat/completions",
    headers: {
      authorization: "Bearer valid-project-key",
    },
    payload: {
      messages: [
        {
          role: "user",
          content: "Trigger the generic policy block path.",
        },
      ],
    },
  });

  assertGatewayError(response, 403, "policy_blocked", "policy_blocked");
  assert.equal(
    response.json().error.message,
    "This request was blocked because no eligible provider or model could be selected for the current request.",
  );
});

test("POST /v1/chat/completions runtime logs the routed provider and returns a structured provider_unavailable error", async (t) => {
  const chatRuntime = createChatCompletionsRuntime({
    authService: createTestAuthService(),
    router: {
      async route() {
        return {
          outcome: "selected" as const,
          selected: {
            provider: "anthropic",
            model: "claude-sonnet-4-20250514",
          },
          selectionReasonCode: "best_score_for_mode",
          selectionReasonText:
            "Selected the best balanced candidate from the local router.",
        };
      },
    },
    providerExecutor: {
      async execute() {
        return {
          provider: "anthropic" as const,
          model: "claude-sonnet-4-20250514",
          requestStatus: "failed" as const,
          finishReason: "not_implemented",
          responseId: "anthropic-stub",
          error: {
            type: "unknown_provider_error" as const,
            code: "not_implemented",
            message: "Anthropic stub adapter is not implemented.",
            retryable: false,
          },
        };
      },
    },
    persistence: createNoopChatPersistence(),
  });
  const { app, logs } = createGatewayAppWithCapturedLogs({
    chatRuntime,
  });

  t.after(async () => {
    await app.close();
  });

  const response = await app.inject({
    method: "POST",
    url: "/v1/chat/completions",
    headers: {
      authorization: "Bearer valid-project-key",
    },
    payload: {
      messages: [
        {
          role: "user",
          content: "Review this function.",
        },
      ],
    },
  });

  assertGatewayError(
    response,
    503,
    "provider_unavailable",
    "provider_runtime_not_ready",
  );
  assert.deepEqual(getEventMessages(logs), [
    "request received",
    "auth result",
    "error raised",
  ]);

  const serializedLogs = JSON.stringify(logs);

  assert.ok(!serializedLogs.includes("Review this function."));
  assert.ok(!serializedLogs.includes("valid-project-key"));
});

test("POST /v1/chat/completions returns a readable invalid provider configuration error without leaking secrets", async (t) => {
  const chatRuntime = createChatCompletionsRuntime({
    authService: createTestAuthService(),
    router: {
      async route() {
        return {
          outcome: "selected" as const,
          selected: {
            provider: "openai",
            model: "gpt-5-mini",
          },
          selectionReasonCode: "best_score_for_mode",
          selectionReasonText:
            "Selected the best balanced candidate from the local router.",
        };
      },
    },
    providerExecutor: createDatabaseChatProviderExecutor({
      getAdapter: () => {
        throw new Error(
          "adapter should not be resolved for invalid credentials",
        );
      },
      loadProviderConfig: async () => {
        throw new ProviderCredentialsResolutionError();
      },
      updateProviderPosture: async () => null,
    }),
    persistence: createNoopChatPersistence(),
  });
  const { app, logs } = createGatewayAppWithCapturedLogs({
    chatRuntime,
  });

  t.after(async () => {
    await app.close();
  });

  const response = await app.inject({
    method: "POST",
    url: "/v1/chat/completions",
    headers: {
      authorization: "Bearer valid-project-key",
    },
    payload: {
      messages: [
        {
          role: "user",
          content: "Run the invalid provider configuration path.",
        },
      ],
    },
  });

  assertGatewayError(
    response,
    503,
    "provider_unavailable",
    "invalid_provider_configuration",
  );
  assert.deepEqual(getEventMessages(logs), [
    "request received",
    "auth result",
    "error raised",
  ]);

  const serializedPayload = JSON.stringify({
    response: response.json(),
    logs,
  });

  assert.ok(serializedPayload.includes("invalid_provider_configuration"));
  assert.ok(
    !serializedPayload.includes("test-provider-invalid-config-secret-1234"),
  );
});

test("POST /v1/chat/completions preserves provider auth failures as a public provider_unavailable error", async (t) => {
  const chatRuntime = createChatCompletionsRuntime({
    authService: createTestAuthService(),
    router: {
      async route() {
        return {
          outcome: "selected" as const,
          selected: {
            provider: "openai",
            model: "gpt-5-mini",
          },
          selectionReasonCode: "best_score_for_mode",
          selectionReasonText:
            "Selected the best balanced candidate from the local router.",
        };
      },
    },
    providerExecutor: {
      async execute() {
        return {
          provider: "openai" as const,
          model: "gpt-5-mini",
          requestStatus: "failed" as const,
          error: {
            type: "auth_error" as const,
            code: "provider_auth_failed",
            message: "OpenAI rejected the provided authentication credentials.",
            retryable: false,
          },
        };
      },
    },
    persistence: createNoopChatPersistence(),
  });
  const app = createGatewayApp({
    authService: createTestAuthService(),
    chatRuntime,
  });

  t.after(async () => {
    await app.close();
  });

  const response = await app.inject({
    method: "POST",
    url: "/v1/chat/completions",
    headers: {
      authorization: "Bearer valid-project-key",
    },
    payload: {
      messages: [
        {
          role: "user",
          content: "Trigger the provider auth failure path.",
        },
      ],
    },
  });

  assertGatewayError(
    response,
    503,
    "provider_unavailable",
    "provider_auth_failed",
  );
  assert.equal(
    response.json().error.message,
    "OpenAI rejected the provided authentication credentials.",
  );
});

test("POST /v1/chat/completions preserves provider configuration missing as a public provider_unavailable error", async (t) => {
  const chatRuntime = createChatCompletionsRuntime({
    authService: createTestAuthService(),
    router: {
      async route() {
        return {
          outcome: "selected" as const,
          selected: {
            provider: "anthropic",
            model: "claude-sonnet-4-20250514",
          },
          selectionReasonCode: "best_score_for_mode",
          selectionReasonText:
            "Selected the best balanced candidate from the local router.",
        };
      },
    },
    providerExecutor: {
      async execute() {
        return {
          provider: "anthropic" as const,
          model: "claude-sonnet-4-20250514",
          requestStatus: "failed" as const,
          error: {
            type: "auth_error" as const,
            code: "provider_configuration_missing",
            message:
              "No usable provider credentials are configured for this workspace.",
            retryable: false,
          },
        };
      },
    },
    persistence: createNoopChatPersistence(),
  });
  const app = createGatewayApp({
    authService: createTestAuthService(),
    chatRuntime,
  });

  t.after(async () => {
    await app.close();
  });

  const response = await app.inject({
    method: "POST",
    url: "/v1/chat/completions",
    headers: {
      authorization: "Bearer valid-project-key",
    },
    payload: {
      messages: [
        {
          role: "user",
          content: "Trigger the provider configuration missing path.",
        },
      ],
    },
  });

  assertGatewayError(
    response,
    503,
    "provider_unavailable",
    "provider_configuration_missing",
  );
  assert.equal(
    response.json().error.message,
    "No usable provider credentials are configured for this workspace.",
  );
});
