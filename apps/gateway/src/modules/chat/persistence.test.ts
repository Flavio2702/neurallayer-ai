import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { type TestContext, test } from "node:test";
import { loadDatabaseConfig } from "@neuralayer/config";
import type {
  GatewaySuccessResponse,
  JsonObject,
  SelectedRoutingDecision,
} from "@neuralayer/core";
import {
  and,
  auditEvents,
  createDbConnection,
  type Database,
  eq,
  externalModelBenchmarks,
  gatewayApiKeys,
  getWorkspaceRecordedCostForPeriod,
  modelCatalog,
  projects,
  providerAccounts,
  requestAttempts,
  requests,
  usageRecords,
  workspaces,
} from "@neuralayer/db";

import { GatewayApiError } from "../../lib/api-error";
import type { EffectiveChatCompletionRequest } from "../../lib/schemas";
import type { GatewayAuthService } from "../auth/context";

import { createDatabaseChatPersistence } from "./persistence";
import { createChatCompletionsRuntime } from "./runtime";

const testLogger = {
  info() {
    return undefined;
  },
};

interface IntegrationFixture {
  workspaceId: string;
  projectId: string;
  apiKeyId: string;
  providerAccountId: string;
  modelCatalogId: string;
  modelId: string;
}

async function openIntegrationDatabase(t: TestContext) {
  const {
    database: { url },
  } = loadDatabaseConfig();
  const { db, queryClient } = createDbConnection(url);

  try {
    await db.select({ id: workspaces.id }).from(workspaces).limit(1);
  } catch (error) {
    await queryClient.end({ timeout: 5 });
    t.skip(
      `Configured database is unavailable for gateway persistence tests: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return null;
  }

  t.after(async () => {
    await queryClient.end({ timeout: 5 });
  });

  return { db };
}

function createRuntimeAuthService(projectId: string): GatewayAuthService {
  return {
    async authenticateApiKey() {
      return null;
    },
    async loadMeContext() {
      throw new Error("loadMeContext is not used by persistence tests.");
    },
    async resolveProject() {
      return {
        id: projectId,
        name: "Persistence Test Project",
      };
    },
  };
}

function createRuntimeInput(input: {
  requestId: string;
  workspaceId: string;
  apiKeyId: string;
  projectId: string;
  metadata?: JsonObject;
}): {
  requestId: string;
  authContext: {
    workspaceId: string;
    apiKeyId: string;
  };
  effectiveRequest: EffectiveChatCompletionRequest;
} {
  return {
    requestId: input.requestId,
    authContext: {
      workspaceId: input.workspaceId,
      apiKeyId: input.apiKeyId,
    },
    effectiveRequest: {
      messages: [
        {
          role: "user",
          content: "Persist this runtime request.",
        },
      ],
      mode: "balanced",
      taskType: "general",
      projectId: input.projectId,
      stream: false,
      metadata: input.metadata,
    },
  };
}

function createSelectedDecision(modelId: string): SelectedRoutingDecision {
  return {
    outcome: "selected",
    selected: {
      provider: "openai",
      model: modelId,
    },
    selectionReasonCode: "best_score_for_mode",
    selectionReasonText:
      "Selected the best balanced candidate from the local router.",
    fallbacksUsed: ["catalog_quality_fallback"],
  };
}

async function seedBenchmarkPricing(
  database: Database,
  input: {
    modelCatalogId: string;
    provider: "openai" | "anthropic";
    modelId: string;
    sourceName: "artificial_analysis";
    syncedAt: string;
    priceInputPer1mTokensUsd: string;
    priceOutputPer1mTokensUsd: string;
  },
) {
  await database.insert(externalModelBenchmarks).values({
    id: `bench_${input.modelCatalogId}_${input.sourceName}`,
    sourceName: input.sourceName,
    externalStableModelId: `ext_${input.modelCatalogId}`,
    modelMappingKey: `${input.provider}:${input.modelId}`,
    modelCatalogId: input.modelCatalogId,
    provider: input.provider,
    modelId: input.modelId,
    priceInputPer1mTokensUsd: input.priceInputPer1mTokensUsd,
    priceOutputPer1mTokensUsd: input.priceOutputPer1mTokensUsd,
    syncedAt: new Date(input.syncedAt),
  });
}

async function createIntegrationFixture(
  database: Database,
  suffix: string,
): Promise<IntegrationFixture> {
  const workspaceId = `ws_gateway_persist_${suffix}`;
  const projectId = `proj_gateway_persist_${suffix}`;
  const apiKeyId = `gak_gateway_persist_${suffix}`;
  const providerAccountId = `provacc_gateway_persist_${suffix}`;
  const modelCatalogId = `mdl_gateway_persist_${suffix}`;
  const modelId = `gpt-5-mini-persist-${suffix}`;

  await database.insert(workspaces).values({
    id: workspaceId,
    name: `Gateway Persistence Workspace ${suffix}`,
    slug: `gateway-persistence-${suffix}`,
    status: "active",
    defaultMode: "balanced",
  });

  await database.insert(projects).values({
    id: projectId,
    workspaceId,
    name: `Gateway Persistence Project ${suffix}`,
    slug: `gateway-persistence-project-${suffix}`,
    status: "active",
    defaultMode: "balanced",
  });

  await database.insert(gatewayApiKeys).values({
    id: apiKeyId,
    workspaceId,
    projectId,
    name: `Gateway Persistence API Key ${suffix}`,
    keyPrefix: `nl_${suffix}`,
    keyHash: `hash_${suffix}`,
    status: "active",
  });

  await database.insert(providerAccounts).values({
    id: providerAccountId,
    workspaceId,
    provider: "openai",
    displayName: `OpenAI Persistence ${suffix}`,
    status: "active",
    encryptedCredentials: `encrypted-openai-${suffix}`,
  });

  await database.insert(modelCatalog).values({
    id: modelCatalogId,
    provider: "openai",
    modelId,
    label: `OpenAI Persistence Model ${suffix}`,
    status: "active",
    isActive: true,
    supportsChat: true,
    supportsStreaming: true,
    capabilityClasses: ["general", "coding"],
    costTier: "medium",
    latencyTier: "medium",
  });

  return {
    workspaceId,
    projectId,
    apiKeyId,
    providerAccountId,
    modelCatalogId,
    modelId,
  };
}

async function cleanupIntegrationFixture(
  database: Database,
  fixture: IntegrationFixture,
) {
  await database
    .delete(externalModelBenchmarks)
    .where(eq(externalModelBenchmarks.modelCatalogId, fixture.modelCatalogId));
  await database
    .delete(usageRecords)
    .where(eq(usageRecords.workspaceId, fixture.workspaceId));
  await database
    .delete(requestAttempts)
    .where(eq(requestAttempts.workspaceId, fixture.workspaceId));
  await database
    .delete(auditEvents)
    .where(eq(auditEvents.workspaceId, fixture.workspaceId));
  await database
    .delete(requests)
    .where(eq(requests.workspaceId, fixture.workspaceId));
  await database
    .delete(gatewayApiKeys)
    .where(eq(gatewayApiKeys.id, fixture.apiKeyId));
  await database
    .delete(providerAccounts)
    .where(eq(providerAccounts.id, fixture.providerAccountId));
  await database.delete(projects).where(eq(projects.id, fixture.projectId));
  await database
    .delete(modelCatalog)
    .where(eq(modelCatalog.id, fixture.modelCatalogId));
  await database
    .delete(workspaces)
    .where(eq(workspaces.id, fixture.workspaceId));
}

test("database-backed persistence stores blocked routing decisions and blocked audit trail", async (t) => {
  const connection = await openIntegrationDatabase(t);

  if (!connection) {
    return;
  }

  const suffix = randomUUID().slice(0, 8);
  const fixture = await createIntegrationFixture(connection.db, suffix);
  const requestId = `req_gateway_blocked_${suffix}`;
  const runtime = createChatCompletionsRuntime({
    authService: createRuntimeAuthService(fixture.projectId),
    router: {
      async route() {
        return {
          outcome: "blocked" as const,
          selectionReasonCode: "policy_blocked_budget_cap",
          selectionReasonText:
            "Blocked because the workspace monthly gateway-recorded budget cap has already been reached.",
          policyDecisions: [
            {
              type: "block" as const,
              enforcementMode: "hard_block" as const,
              reasonCode: "policy_blocked_budget_cap",
              message:
                "The workspace monthly budget cap is already exhausted for this request.",
              metadata: {
                current_spend_usd: 50,
                limit_usd: 50,
              },
            },
          ],
        };
      },
    },
    providerExecutor: {
      async execute() {
        throw new Error(
          "Provider execution should not start for blocked requests.",
        );
      },
    },
    persistence: createDatabaseChatPersistence({
      database: connection.db,
    }),
    logger: testLogger,
  });

  try {
    await assert.rejects(
      runtime.execute(
        createRuntimeInput({
          requestId,
          workspaceId: fixture.workspaceId,
          apiKeyId: fixture.apiKeyId,
          projectId: fixture.projectId,
          metadata: {
            source: "integration-blocked",
          },
        }),
      ),
      (error) => {
        assert.equal(error instanceof GatewayApiError, true);
        assert.equal((error as GatewayApiError).type, "policy_blocked");
        assert.equal(
          (error as GatewayApiError).code,
          "workspace_budget_exceeded",
        );
        return true;
      },
    );

    const [requestRow] = await connection.db
      .select()
      .from(requests)
      .where(eq(requests.id, requestId))
      .limit(1);
    const attemptRows = await connection.db
      .select()
      .from(requestAttempts)
      .where(eq(requestAttempts.requestId, requestId));
    const usageRows = await connection.db
      .select()
      .from(usageRecords)
      .where(eq(usageRecords.requestId, requestId));
    const auditRows = await connection.db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.workspaceId, fixture.workspaceId),
          eq(auditEvents.entityId, requestId),
        ),
      );

    assert.ok(requestRow);
    assert.equal(requestRow.status, "blocked");
    assert.deepEqual(requestRow.requestMetadata, {
      source: "integration-blocked",
    });
    assert.deepEqual(requestRow.normalizedRequestJson, {
      stream: false,
      message_count: 1,
      message_roles: ["user"],
      metadata_keys: ["source"],
      prompt_redacted: true,
    });
    assert.equal(attemptRows.length, 0);
    assert.equal(usageRows.length, 0);
    assert.equal(auditRows.length, 2);

    const routingDecisionEvent = auditRows.find(
      (row) => row.eventType === "chat.routing.decision",
    );
    const blockedEvent = auditRows.find(
      (row) => row.eventType === "chat.completions.blocked",
    );

    assert.ok(routingDecisionEvent);
    assert.ok(blockedEvent);
    assert.equal(
      (
        routingDecisionEvent?.eventPayload as {
          routing_decision?: { outcome?: string; selectionReasonCode?: string };
        }
      )?.routing_decision?.outcome,
      "blocked",
    );
    assert.equal(
      (
        blockedEvent?.eventPayload as {
          metadata?: {
            request_status?: string;
            error_code?: string;
            current_spend_usd?: number;
            limit_usd?: number;
            budget_remaining_usd?: number;
            usage_recorded?: boolean;
            cost_total_usd?: number;
          };
        }
      )?.metadata?.request_status,
      "blocked",
    );
    assert.equal(
      (
        blockedEvent?.eventPayload as {
          metadata?: {
            request_status?: string;
            error_code?: string;
            current_spend_usd?: number;
            limit_usd?: number;
            budget_remaining_usd?: number;
            usage_recorded?: boolean;
            cost_total_usd?: number;
          };
        }
      )?.metadata?.error_code,
      "policy_blocked_budget_cap",
    );
    assert.equal(
      (
        blockedEvent?.eventPayload as {
          metadata?: {
            current_spend_usd?: number;
            limit_usd?: number;
            budget_remaining_usd?: number;
            usage_recorded?: boolean;
            cost_total_usd?: number;
          };
        }
      )?.metadata?.current_spend_usd,
      50,
    );
    assert.equal(
      (
        blockedEvent?.eventPayload as {
          metadata?: {
            current_spend_usd?: number;
            limit_usd?: number;
            budget_remaining_usd?: number;
            usage_recorded?: boolean;
            cost_total_usd?: number;
          };
        }
      )?.metadata?.limit_usd,
      50,
    );
    assert.equal(
      (
        blockedEvent?.eventPayload as {
          metadata?: {
            current_spend_usd?: number;
            limit_usd?: number;
            budget_remaining_usd?: number;
            usage_recorded?: boolean;
            cost_total_usd?: number;
          };
        }
      )?.metadata?.budget_remaining_usd,
      0,
    );
    assert.equal(
      (
        blockedEvent?.eventPayload as {
          metadata?: {
            current_spend_usd?: number;
            limit_usd?: number;
            budget_remaining_usd?: number;
            usage_recorded?: boolean;
            cost_total_usd?: number;
          };
        }
      )?.metadata?.usage_recorded,
      false,
    );
    assert.equal(
      (
        blockedEvent?.eventPayload as {
          metadata?: {
            current_spend_usd?: number;
            limit_usd?: number;
            budget_remaining_usd?: number;
            usage_recorded?: boolean;
            cost_total_usd?: number;
          };
        }
      )?.metadata?.cost_total_usd,
      0,
    );

    const recordedCost = await getWorkspaceRecordedCostForPeriod(
      {
        workspaceId: fixture.workspaceId,
        start: new Date("2000-01-01T00:00:00.000Z"),
        end: new Date("2100-01-01T00:00:00.000Z"),
      },
      connection.db,
    );

    assert.equal(recordedCost.totalCostUsd, 0);
  } finally {
    await cleanupIntegrationFixture(connection.db, fixture);
  }
});

test("database-backed persistence stores benchmark-estimated usage and audit summaries for selected flow", async (t) => {
  const connection = await openIntegrationDatabase(t);

  if (!connection) {
    return;
  }

  const suffix = randomUUID().slice(0, 8);
  const fixture = await createIntegrationFixture(connection.db, suffix);
  const requestId = `req_gateway_selected_${suffix}`;
  const benchmarkTimestamp = "2099-04-01T00:00:00.000Z";

  await seedBenchmarkPricing(connection.db, {
    modelCatalogId: fixture.modelCatalogId,
    provider: "openai",
    modelId: fixture.modelId,
    sourceName: "artificial_analysis",
    syncedAt: benchmarkTimestamp,
    priceInputPer1mTokensUsd: "2",
    priceOutputPer1mTokensUsd: "8",
  });

  const runtime = createChatCompletionsRuntime({
    authService: createRuntimeAuthService(fixture.projectId),
    router: {
      async route() {
        return {
          ...createSelectedDecision(fixture.modelId),
          benchmarkSource: "artificial_analysis",
          benchmarkTimestamp,
        };
      },
    },
    providerExecutor: {
      async execute() {
        return {
          provider: "openai" as const,
          model: fixture.modelId,
          requestStatus: "succeeded" as const,
          outputText: "Persisted runtime response.",
          finishReason: "stop",
          responseId: `resp_${suffix}`,
          latencyMs: 42,
          usage: {
            provider: "openai" as const,
            model: fixture.modelId,
            inputTokens: 1_500_000,
            outputTokens: 500_000,
            totalTokens: 2_000_000,
          },
        };
      },
    },
    persistence: createDatabaseChatPersistence({
      database: connection.db,
    }),
    logger: testLogger,
  });

  try {
    const response = (await runtime.execute(
      createRuntimeInput({
        requestId,
        workspaceId: fixture.workspaceId,
        apiKeyId: fixture.apiKeyId,
        projectId: fixture.projectId,
        metadata: {
          source: "integration-selected",
        },
      }),
    )) as GatewaySuccessResponse;

    assert.equal(response.id, requestId);
    assert.equal(response.provider, "openai");
    assert.equal(response.model, fixture.modelId);

    const [requestRow] = await connection.db
      .select()
      .from(requests)
      .where(eq(requests.id, requestId))
      .limit(1);
    const [attemptRow] = await connection.db
      .select()
      .from(requestAttempts)
      .where(eq(requestAttempts.requestId, requestId))
      .limit(1);
    const [usageRow] = await connection.db
      .select()
      .from(usageRecords)
      .where(eq(usageRecords.requestId, requestId))
      .limit(1);
    const auditRows = await connection.db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.workspaceId, fixture.workspaceId),
          eq(auditEvents.entityId, requestId),
        ),
      );

    assert.ok(requestRow);
    assert.ok(attemptRow);
    assert.ok(usageRow);
    assert.equal(requestRow.status, "succeeded");
    assert.deepEqual(requestRow.requestMetadata, {
      source: "integration-selected",
    });
    assert.deepEqual(requestRow.normalizedRequestJson, {
      stream: false,
      message_count: 1,
      message_roles: ["user"],
      metadata_keys: ["source"],
      prompt_redacted: true,
    });
    assert.equal(attemptRow.providerAccountId, fixture.providerAccountId);
    assert.equal(attemptRow.modelCatalogId, fixture.modelCatalogId);
    assert.equal(attemptRow.status, "succeeded");
    assert.equal(
      attemptRow.selectionReason,
      "Selected the best balanced candidate from the local router.",
    );
    assert.equal(attemptRow.providerRequestId, `resp_${suffix}`);
    assert.equal(Number(attemptRow.latencyMs), 42);
    assert.equal(usageRow.attemptId, attemptRow.id);
    assert.equal(usageRow.usageSource, "estimated");
    assert.equal(Number(usageRow.costInput ?? 0), 3);
    assert.equal(Number(usageRow.costOutput ?? 0), 4);
    assert.equal(Number(usageRow.costTotal ?? 0), 7);
    assert.equal(
      usageRow.pricingVersion,
      `artificial_analysis:${benchmarkTimestamp}`,
    );
    assert.equal(usageRow.totalTokens, 2_000_000);
    assert.equal(auditRows.length, 2);

    const routingDecisionEvent = auditRows.find(
      (row) => row.eventType === "chat.routing.decision",
    );
    const completedEvent = auditRows.find(
      (row) => row.eventType === "chat.completions.completed",
    );

    assert.ok(routingDecisionEvent);
    assert.ok(completedEvent);
    assert.equal(
      (
        routingDecisionEvent?.eventPayload as {
          routing_decision?: {
            outcome?: string;
            selected?: { provider?: string; model?: string };
          };
        }
      )?.routing_decision?.outcome,
      "selected",
    );
    assert.equal(
      (
        routingDecisionEvent?.eventPayload as {
          routing_decision?: {
            outcome?: string;
            selected?: { provider?: string; model?: string };
          };
        }
      )?.routing_decision?.selected?.model,
      fixture.modelId,
    );
    assert.equal(
      (
        completedEvent?.eventPayload as {
          metadata?: {
            request_status?: string;
            provider?: string;
            usage_recorded?: boolean;
            usage_source?: string;
            cost_total_usd?: number;
            pricing_version?: string;
          };
        }
      )?.metadata?.request_status,
      "succeeded",
    );
    assert.equal(
      (
        completedEvent?.eventPayload as {
          metadata?: {
            request_status?: string;
            provider?: string;
            usage_recorded?: boolean;
            usage_source?: string;
            cost_total_usd?: number;
            pricing_version?: string;
          };
        }
      )?.metadata?.provider,
      "openai",
    );
    assert.equal(
      (
        completedEvent?.eventPayload as {
          metadata?: {
            usage_recorded?: boolean;
            usage_source?: string;
            cost_total_usd?: number;
            pricing_version?: string;
          };
        }
      )?.metadata?.usage_recorded,
      true,
    );
    assert.equal(
      (
        completedEvent?.eventPayload as {
          metadata?: {
            usage_recorded?: boolean;
            usage_source?: string;
            cost_total_usd?: number;
            pricing_version?: string;
          };
        }
      )?.metadata?.usage_source,
      "estimated",
    );
    assert.equal(
      (
        completedEvent?.eventPayload as {
          metadata?: {
            usage_recorded?: boolean;
            usage_source?: string;
            cost_total_usd?: number;
            pricing_version?: string;
          };
        }
      )?.metadata?.cost_total_usd,
      7,
    );
    assert.equal(
      (
        completedEvent?.eventPayload as {
          metadata?: {
            usage_recorded?: boolean;
            usage_source?: string;
            cost_total_usd?: number;
            pricing_version?: string;
          };
        }
      )?.metadata?.pricing_version,
      `artificial_analysis:${benchmarkTimestamp}`,
    );

    const recordedCost = await getWorkspaceRecordedCostForPeriod(
      {
        workspaceId: fixture.workspaceId,
        start: new Date("2000-01-01T00:00:00.000Z"),
        end: new Date("2100-01-01T00:00:00.000Z"),
      },
      connection.db,
    );

    assert.equal(recordedCost.totalCostUsd, 7);
  } finally {
    await cleanupIntegrationFixture(connection.db, fixture);
  }
});

test("database-backed persistence stores cost-tier estimated usage for provider failure", async (t) => {
  const connection = await openIntegrationDatabase(t);

  if (!connection) {
    return;
  }

  const suffix = randomUUID().slice(0, 8);
  const fixture = await createIntegrationFixture(connection.db, suffix);
  const requestId = `req_gateway_failed_${suffix}`;
  const runtime = createChatCompletionsRuntime({
    authService: createRuntimeAuthService(fixture.projectId),
    router: {
      async route() {
        return createSelectedDecision(fixture.modelId);
      },
    },
    providerExecutor: {
      async execute() {
        return {
          provider: "openai" as const,
          model: fixture.modelId,
          requestStatus: "failed" as const,
          finishReason: "provider_error",
          responseId: `resp_failed_${suffix}`,
          latencyMs: 64,
          usage: {
            provider: "openai" as const,
            model: fixture.modelId,
            inputTokens: 2_000_000,
            outputTokens: 1_000_000,
            totalTokens: 3_000_000,
          },
          error: {
            type: "provider_unavailable" as const,
            code: "provider_runtime_failed",
            message: "Provider execution failed after returning usage.",
            retryable: true,
          },
        };
      },
    },
    persistence: createDatabaseChatPersistence({
      database: connection.db,
    }),
    logger: testLogger,
  });

  try {
    await assert.rejects(
      runtime.execute(
        createRuntimeInput({
          requestId,
          workspaceId: fixture.workspaceId,
          apiKeyId: fixture.apiKeyId,
          projectId: fixture.projectId,
          metadata: {
            source: "integration-failed",
          },
        }),
      ),
      (error) => {
        assert.equal(error instanceof GatewayApiError, true);
        assert.equal((error as GatewayApiError).type, "provider_unavailable");
        assert.equal(
          (error as GatewayApiError).code,
          "provider_runtime_failed",
        );
        return true;
      },
    );

    const [requestRow] = await connection.db
      .select()
      .from(requests)
      .where(eq(requests.id, requestId))
      .limit(1);
    const [attemptRow] = await connection.db
      .select()
      .from(requestAttempts)
      .where(eq(requestAttempts.requestId, requestId))
      .limit(1);
    const [usageRow] = await connection.db
      .select()
      .from(usageRecords)
      .where(eq(usageRecords.requestId, requestId))
      .limit(1);
    const auditRows = await connection.db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.workspaceId, fixture.workspaceId),
          eq(auditEvents.entityId, requestId),
        ),
      );

    assert.ok(requestRow);
    assert.ok(attemptRow);
    assert.ok(usageRow);
    assert.equal(requestRow.status, "failed");
    assert.equal(attemptRow.status, "failed");
    assert.equal(Number(attemptRow.latencyMs), 64);
    assert.equal(usageRow.usageSource, "estimated");
    assert.equal(Number(usageRow.costInput ?? 0), 6);
    assert.equal(Number(usageRow.costOutput ?? 0), 15);
    assert.equal(Number(usageRow.costTotal ?? 0), 21);
    assert.equal(usageRow.pricingVersion, "catalog_cost_tier_v1");
    assert.equal(auditRows.length, 2);

    const failedEvent = auditRows.find(
      (row) => row.eventType === "chat.completions.failed",
    );

    assert.ok(failedEvent);
    assert.equal(
      (
        failedEvent?.eventPayload as {
          metadata?: {
            usage_recorded?: boolean;
            usage_source?: string;
            cost_total_usd?: number;
            pricing_version?: string;
            request_status?: string;
          };
        }
      )?.metadata?.request_status,
      "failed",
    );
    assert.equal(
      (
        failedEvent?.eventPayload as {
          metadata?: {
            usage_recorded?: boolean;
            usage_source?: string;
            cost_total_usd?: number;
            pricing_version?: string;
            request_status?: string;
          };
        }
      )?.metadata?.usage_recorded,
      true,
    );
    assert.equal(
      (
        failedEvent?.eventPayload as {
          metadata?: {
            usage_recorded?: boolean;
            usage_source?: string;
            cost_total_usd?: number;
            pricing_version?: string;
            request_status?: string;
          };
        }
      )?.metadata?.usage_source,
      "estimated",
    );
    assert.equal(
      (
        failedEvent?.eventPayload as {
          metadata?: {
            usage_recorded?: boolean;
            usage_source?: string;
            cost_total_usd?: number;
            pricing_version?: string;
            request_status?: string;
          };
        }
      )?.metadata?.cost_total_usd,
      21,
    );
    assert.equal(
      (
        failedEvent?.eventPayload as {
          metadata?: {
            usage_recorded?: boolean;
            usage_source?: string;
            cost_total_usd?: number;
            pricing_version?: string;
            request_status?: string;
          };
        }
      )?.metadata?.pricing_version,
      "catalog_cost_tier_v1",
    );

    const recordedCost = await getWorkspaceRecordedCostForPeriod(
      {
        workspaceId: fixture.workspaceId,
        start: new Date("2000-01-01T00:00:00.000Z"),
        end: new Date("2100-01-01T00:00:00.000Z"),
      },
      connection.db,
    );

    assert.equal(recordedCost.totalCostUsd, 21);
  } finally {
    await cleanupIntegrationFixture(connection.db, fixture);
  }
});
