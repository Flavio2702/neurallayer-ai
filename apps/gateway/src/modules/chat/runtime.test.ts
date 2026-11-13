import assert from "node:assert/strict";
import { test } from "node:test";

import type {
  AuditEvent,
  ProviderAttempt,
  ProviderExecutionResult,
  RequestStatus,
  SelectedRoutingDecision,
} from "@neuralayer/core";

import { GatewayApiError } from "../../lib/api-error";
import type { EffectiveChatCompletionRequest } from "../../lib/schemas";
import type { GatewayAuthService } from "../auth/context";

import type { ChatPersistence, PersistedUsageSummary } from "./persistence";
import { createChatCompletionsRuntime } from "./runtime";

const testLogger = {
  info() {
    return undefined;
  },
};

function createRuntimeAuthService(
  resolvedProjectId: string | null = "proj_runtime",
): GatewayAuthService {
  return {
    async authenticateApiKey() {
      return null;
    },
    async loadMeContext() {
      throw new Error("loadMeContext is not used by runtime tests.");
    },
    async resolveProject() {
      if (!resolvedProjectId) {
        return null;
      }

      return {
        id: resolvedProjectId,
        name: "Runtime Project",
      };
    },
  };
}

function createRuntimeInput(
  overrides: Partial<EffectiveChatCompletionRequest> = {},
) {
  return {
    requestId: "req_runtime",
    authContext: {
      workspaceId: "ws_runtime",
      apiKeyId: "gak_runtime",
    },
    effectiveRequest: {
      messages: [
        {
          role: "user" as const,
          content: "Inspect the runtime flow.",
        },
      ],
      mode: "balanced" as const,
      taskType: "general" as const,
      projectId: "proj_requested",
      stream: false,
      ...overrides,
    },
  };
}

function createSelectedDecision(
  overrides: Partial<SelectedRoutingDecision> = {},
): SelectedRoutingDecision {
  return {
    outcome: "selected",
    selected: {
      provider: "openai",
      model: "gpt-5-mini",
    },
    selectionReasonCode: "catalog_fallback_no_benchmark",
    selectionReasonText:
      "Selected the first deterministic candidate from the bootstrap catalog.",
    fallbacksUsed: ["bootstrap_catalog"],
    ...overrides,
  };
}

function createTrackingPersistence() {
  const calls: string[] = [];
  const attemptStatuses: ProviderAttempt["status"][] = [];
  const auditEvents: AuditEvent[] = [];
  const requestStatuses: RequestStatus[] = [];
  const usageSummaries: PersistedUsageSummary[] = [];

  const persistence: ChatPersistence = {
    async recordRequestStarted() {
      calls.push("recordRequestStarted");
    },
    async recordRoutingDecision() {
      calls.push("recordRoutingDecision");
    },
    async recordAttemptStarted(input) {
      calls.push("recordAttemptStarted");
      attemptStatuses.push(input.attempt.status);
    },
    async recordAttemptCompleted(input) {
      calls.push("recordAttemptCompleted");
      attemptStatuses.push(input.attempt.status);
    },
    async recordUsage(input) {
      calls.push("recordUsage");
      const totalTokens =
        input.usage.totalTokens ??
        (typeof input.usage.inputTokens === "number" &&
        typeof input.usage.outputTokens === "number"
          ? input.usage.inputTokens + input.usage.outputTokens
          : undefined);
      const summary: PersistedUsageSummary =
        typeof input.usage.costUsd === "number"
          ? {
              usageSource: "provider_reported",
              inputTokens: input.usage.inputTokens,
              outputTokens: input.usage.outputTokens,
              totalTokens,
              costTotalUsd: input.usage.costUsd,
              currency: "USD",
            }
          : {
              usageSource: "estimated",
              inputTokens: input.usage.inputTokens,
              outputTokens: input.usage.outputTokens,
              totalTokens,
              costTotalUsd:
                typeof totalTokens === "number"
                  ? totalTokens / 1000
                  : undefined,
              pricingVersion: "tracking_estimate_v1",
              currency: "USD",
            };

      usageSummaries.push(summary);

      return summary;
    },
    async recordAuditEvent(input) {
      calls.push("recordAuditEvent");
      auditEvents.push(input.auditEvent);
    },
    async recordRequestCompleted(input) {
      calls.push("recordRequestCompleted");
      requestStatuses.push(input.status);
    },
  };

  return {
    calls,
    attemptStatuses,
    auditEvents,
    requestStatuses,
    usageSummaries,
    persistence,
  };
}

test("chat runtime stops before routing when no project can be resolved", async () => {
  const tracker = createTrackingPersistence();
  let routerCalls = 0;
  let providerCalls = 0;
  const runtime = createChatCompletionsRuntime({
    authService: createRuntimeAuthService(null),
    router: {
      async route() {
        routerCalls += 1;

        return createSelectedDecision();
      },
    },
    providerExecutor: {
      async execute() {
        providerCalls += 1;

        throw new Error("Provider execution should not start.");
      },
    },
    persistence: tracker.persistence,
    logger: testLogger,
  });

  await assert.rejects(runtime.execute(createRuntimeInput()), (error) => {
    assert.equal(error instanceof GatewayApiError, true);
    assert.equal((error as GatewayApiError).type, "invalid_request");
    assert.equal((error as GatewayApiError).code, "missing_project_id");
    return true;
  });

  assert.equal(routerCalls, 0);
  assert.equal(providerCalls, 0);
  assert.deepEqual(tracker.calls, []);
});

test("chat runtime records blocked routing without starting provider execution", async () => {
  const tracker = createTrackingPersistence();
  let providerCalls = 0;
  const runtime = createChatCompletionsRuntime({
    authService: createRuntimeAuthService(),
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
        providerCalls += 1;

        throw new Error("Provider execution should not start.");
      },
    },
    persistence: tracker.persistence,
    logger: testLogger,
  });

  await assert.rejects(runtime.execute(createRuntimeInput()), (error) => {
    assert.equal(error instanceof GatewayApiError, true);
    assert.equal((error as GatewayApiError).type, "policy_blocked");
    assert.equal((error as GatewayApiError).code, "workspace_budget_exceeded");
    assert.equal(
      (error as GatewayApiError).message,
      "Blocked because the workspace monthly gateway-recorded budget cap has already been reached.",
    );
    return true;
  });

  assert.equal(providerCalls, 0);
  assert.deepEqual(tracker.calls, [
    "recordRequestStarted",
    "recordRoutingDecision",
    "recordAuditEvent",
    "recordRequestCompleted",
  ]);
  assert.deepEqual(tracker.requestStatuses, ["blocked"]);
  assert.equal(tracker.auditEvents[0]?.eventType, "chat.completions.blocked");
  assert.equal(
    (tracker.auditEvents[0]?.metadata as { usage_recorded?: boolean })
      ?.usage_recorded,
    false,
  );
});

test("chat runtime normalizes non-budget routing blocks to the generic public policy_blocked code", async () => {
  const runtime = createChatCompletionsRuntime({
    authService: createRuntimeAuthService(),
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
        throw new Error("Provider execution should not start.");
      },
    },
    persistence: createTrackingPersistence().persistence,
    logger: testLogger,
  });

  await assert.rejects(runtime.execute(createRuntimeInput()), (error) => {
    assert.equal(error instanceof GatewayApiError, true);
    assert.equal((error as GatewayApiError).type, "policy_blocked");
    assert.equal((error as GatewayApiError).code, "policy_blocked");
    assert.equal(
      (error as GatewayApiError).message,
      "This request was blocked because no eligible provider or model could be selected for the current request.",
    );
    return true;
  });
});

test("chat runtime records usage before audit and completion for succeeded provider execution", async () => {
  const tracker = createTrackingPersistence();
  const runtime = createChatCompletionsRuntime({
    authService: createRuntimeAuthService(),
    router: {
      async route() {
        return createSelectedDecision();
      },
    },
    providerExecutor: {
      async execute(): Promise<ProviderExecutionResult> {
        return {
          provider: "openai",
          model: "gpt-5-mini",
          requestStatus: "succeeded",
          outputText: "Succeeded.",
          finishReason: "stop",
          responseId: "openai-success-req_runtime",
          latencyMs: 18,
          usage: {
            provider: "openai",
            model: "gpt-5-mini",
            inputTokens: 12,
            outputTokens: 8,
            totalTokens: 20,
            costUsd: 1.25,
          },
        };
      },
    },
    persistence: tracker.persistence,
    logger: testLogger,
  });

  const response = await runtime.execute(createRuntimeInput());

  assert.equal(response.provider, "openai");
  assert.deepEqual(response.meta.selection_reason, {
    code: "catalog_fallback_no_benchmark",
    text: "Selected the first deterministic candidate from the bootstrap catalog.",
  });
  assert.equal(response.meta.cost_usd, 1.25);
  assert.equal(response.meta.cost_source, "provider_reported");
  assert.equal(response.meta.warnings, undefined);
  assert.deepEqual(tracker.calls, [
    "recordRequestStarted",
    "recordRoutingDecision",
    "recordAttemptStarted",
    "recordAttemptCompleted",
    "recordUsage",
    "recordAuditEvent",
    "recordRequestCompleted",
  ]);
  assert.deepEqual(tracker.requestStatuses, ["succeeded"]);
  assert.equal(tracker.usageSummaries[0]?.costTotalUsd, 1.25);
  assert.equal(
    (
      tracker.auditEvents[0]?.metadata as {
        usage_recorded?: boolean;
        cost_total_usd?: number;
      }
    )?.usage_recorded,
    true,
  );
  assert.equal(
    (
      tracker.auditEvents[0]?.metadata as {
        usage_recorded?: boolean;
        cost_total_usd?: number;
      }
    )?.cost_total_usd,
    1.25,
  );
});

test("chat runtime exposes compact routing warnings and estimated cost in the succeeded response", async () => {
  const tracker = createTrackingPersistence();
  const runtime = createChatCompletionsRuntime({
    authService: createRuntimeAuthService(),
    router: {
      async route() {
        return createSelectedDecision({
          selectionReasonCode: "best_score_for_mode",
          selectionReasonText:
            "Selected openai/gpt-5-mini because it had the best balanced score across policy-eligible candidates.",
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
        });
      },
    },
    providerExecutor: {
      async execute(): Promise<ProviderExecutionResult> {
        return {
          provider: "openai",
          model: "gpt-5-mini",
          requestStatus: "succeeded",
          outputText: "Succeeded with estimated cost.",
          finishReason: "stop",
          responseId: "openai-estimated-success-req_runtime",
          latencyMs: 24,
          usage: {
            provider: "openai",
            model: "gpt-5-mini",
            inputTokens: 12,
            outputTokens: 8,
            totalTokens: 20,
          },
        };
      },
    },
    persistence: tracker.persistence,
    logger: testLogger,
  });

  const response = await runtime.execute(createRuntimeInput());

  assert.deepEqual(response.meta.selection_reason, {
    code: "best_score_for_mode",
    text: "Selected openai/gpt-5-mini because it had the best balanced score across policy-eligible candidates.",
  });
  assert.deepEqual(response.meta.warnings, [
    {
      code: "benchmark_snapshot_stale",
      message:
        "The latest local benchmark snapshot is older than 7 days, so routing continued with a staleness warning.",
    },
  ]);
  assert.equal(response.meta.cost_usd, 0.02);
  assert.equal(response.meta.cost_source, "estimated");
});

test("chat runtime records failed attempt state and audit when provider execution throws after the attempt starts", async () => {
  const tracker = createTrackingPersistence();
  let providerCalls = 0;
  const runtime = createChatCompletionsRuntime({
    authService: createRuntimeAuthService(),
    router: {
      async route() {
        return createSelectedDecision();
      },
    },
    providerExecutor: {
      async execute() {
        providerCalls += 1;

        throw new Error("Provider execution crashed.");
      },
    },
    persistence: tracker.persistence,
    logger: testLogger,
  });

  await assert.rejects(runtime.execute(createRuntimeInput()), (error) => {
    assert.equal(error instanceof Error, true);
    assert.equal((error as Error).message, "Provider execution crashed.");
    return true;
  });

  assert.equal(providerCalls, 1);
  assert.deepEqual(tracker.calls, [
    "recordRequestStarted",
    "recordRoutingDecision",
    "recordAttemptStarted",
    "recordAttemptCompleted",
    "recordAuditEvent",
    "recordRequestCompleted",
  ]);
  assert.deepEqual(tracker.attemptStatuses, ["running", "failed"]);
  assert.deepEqual(tracker.requestStatuses, ["failed"]);
  assert.equal(tracker.auditEvents[0]?.eventType, "chat.completions.failed");
});

test("chat runtime records attempt lifecycle and maps placeholder provider failure without retrying", async () => {
  const tracker = createTrackingPersistence();
  let providerCalls = 0;
  const runtime = createChatCompletionsRuntime({
    authService: createRuntimeAuthService(),
    router: {
      async route() {
        return createSelectedDecision();
      },
    },
    providerExecutor: {
      async execute(): Promise<ProviderExecutionResult> {
        providerCalls += 1;

        return {
          provider: "openai",
          model: "gpt-5-mini",
          requestStatus: "failed",
          finishReason: "not_implemented",
          responseId: "openai-stub-req_runtime",
          error: {
            type: "unknown_provider_error",
            code: "not_implemented",
            message: "OpenAI stub adapter is not implemented.",
            retryable: false,
          },
        };
      },
    },
    persistence: tracker.persistence,
    logger: testLogger,
  });

  await assert.rejects(runtime.execute(createRuntimeInput()), (error) => {
    assert.equal(error instanceof GatewayApiError, true);
    assert.equal((error as GatewayApiError).type, "provider_unavailable");
    assert.equal((error as GatewayApiError).code, "provider_runtime_not_ready");
    return true;
  });

  assert.equal(providerCalls, 1);
  assert.deepEqual(tracker.calls, [
    "recordRequestStarted",
    "recordRoutingDecision",
    "recordAttemptStarted",
    "recordAttemptCompleted",
    "recordAuditEvent",
    "recordRequestCompleted",
  ]);
  assert.deepEqual(tracker.attemptStatuses, ["running", "failed"]);
  assert.deepEqual(tracker.requestStatuses, ["failed"]);
  assert.equal(tracker.auditEvents[0]?.eventType, "chat.completions.failed");
});

test("chat runtime records usage for failed provider execution before writing failed audit state", async () => {
  const tracker = createTrackingPersistence();
  let providerCalls = 0;
  const runtime = createChatCompletionsRuntime({
    authService: createRuntimeAuthService(),
    router: {
      async route() {
        return createSelectedDecision();
      },
    },
    providerExecutor: {
      async execute(): Promise<ProviderExecutionResult> {
        providerCalls += 1;

        return {
          provider: "openai",
          model: "gpt-5-mini",
          requestStatus: "failed",
          finishReason: "provider_error",
          responseId: "openai-failed-req_runtime",
          latencyMs: 27,
          usage: {
            provider: "openai",
            model: "gpt-5-mini",
            inputTokens: 120,
            outputTokens: 30,
            totalTokens: 150,
          },
          error: {
            type: "provider_unavailable",
            code: "provider_down",
            message: "Provider is unavailable.",
            retryable: true,
          },
        };
      },
    },
    persistence: tracker.persistence,
    logger: testLogger,
  });

  await assert.rejects(runtime.execute(createRuntimeInput()), (error) => {
    assert.equal(error instanceof GatewayApiError, true);
    assert.equal((error as GatewayApiError).type, "provider_unavailable");
    assert.equal((error as GatewayApiError).code, "provider_down");
    return true;
  });

  assert.equal(providerCalls, 1);
  assert.deepEqual(tracker.calls, [
    "recordRequestStarted",
    "recordRoutingDecision",
    "recordAttemptStarted",
    "recordAttemptCompleted",
    "recordUsage",
    "recordAuditEvent",
    "recordRequestCompleted",
  ]);
  assert.deepEqual(tracker.requestStatuses, ["failed"]);
  assert.equal(tracker.usageSummaries[0]?.usageSource, "estimated");
  assert.equal(
    (
      tracker.auditEvents[0]?.metadata as {
        usage_recorded?: boolean;
        pricing_version?: string | null;
      }
    )?.usage_recorded,
    true,
  );
  assert.equal(
    (
      tracker.auditEvents[0]?.metadata as {
        usage_recorded?: boolean;
        pricing_version?: string | null;
      }
    )?.pricing_version,
    "tracking_estimate_v1",
  );
});
