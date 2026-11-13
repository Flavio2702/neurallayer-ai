import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { type TestContext, test } from "node:test";

import { loadDatabaseConfig } from "@neuralayer/config";
import {
  and,
  auditEvents,
  createDbConnection,
  type Database,
  encryptProviderCredentials,
  eq,
  externalModelBenchmarks,
  gatewayApiKeys,
  getGatewayApiKeyPrefix,
  getWorkspaceOverviewStats,
  getWorkspaceRecordedCostForPeriod,
  hashGatewayApiKey,
  listActiveChatModelCatalogWithLatestBenchmarks,
  listActiveGatewayApiKeySummaries,
  listActiveScopedPolicyRules,
  listActiveWorkspaceProviderAccounts,
  listProviderStatusSummaries,
  listRecentWorkspaceAuditEvents,
  listRecentWorkspaceRequests,
  modelCatalog,
  policyRules,
  projects,
  providerAccounts,
  requestAttempts,
  requests,
  resolveProviderAccountExecutionConfig,
  resolveRoutingProfileForProject,
  updateProviderAccountRuntimePosture,
  usageRecords,
  workspaces,
} from "@neuralayer/db";
import {
  createAnthropicAdapter,
  createOpenAIAdapter,
} from "@neuralayer/provider-adapters";

import { createGatewayApp } from "./app";
import { createDatabaseGatewayAuthService } from "./modules/auth/context";
import { createDatabaseChatPersistence } from "./modules/chat/persistence";
import { createDatabaseChatProviderExecutor } from "./modules/chat/provider-executor";
import { createDatabaseChatRouter } from "./modules/chat/router";
import { createChatCompletionsRuntime } from "./modules/chat/runtime";

const BENCHMARK_TIMESTAMP = "2099-04-01T00:00:00.000Z";
const OPENAI_BASE_URL = "https://openai.demo-path.test/v1";
const ANTHROPIC_BASE_URL = "https://anthropic.demo-path.test/v1";
const EXPECTED_RECORDED_COST_USD = 6;
const SUCCESS_INPUT_TOKENS = 1_000_000;
const SUCCESS_OUTPUT_TOKENS = 500_000;
const TEST_PROVIDER_CREDENTIALS_SECRET = "provider-credentials-secret-123";

process.env.PROVIDER_CREDENTIALS_SECRET ??= TEST_PROVIDER_CREDENTIALS_SECRET;

interface DemoFixture {
  workspaceId: string;
  projectId: string;
  apiKeyId: string;
  rawApiKey: string;
  openaiAccountId: string;
  anthropicAccountId: string;
  openaiModelCatalogId: string;
  anthropicModelCatalogId: string;
  openaiModelId: string;
  anthropicModelId: string;
}

interface ProviderTransportCall {
  provider: "openai" | "anthropic";
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
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
      `Configured database is unavailable for gateway demo-path smoke tests: ${
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

function getUtcMonthRange(now = new Date()) {
  return {
    start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
    end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
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

function headersToObject(
  headers: ConstructorParameters<typeof Headers>[0] | undefined,
) {
  return Object.fromEntries(new Headers(headers).entries());
}

function parseJsonBody(body: unknown) {
  return JSON.parse(String(body ?? "{}")) as Record<string, unknown>;
}

async function createDemoFixture(
  database: Database,
  suffix: string,
): Promise<DemoFixture> {
  const workspaceId = `ws_demo_path_${suffix}`;
  const projectId = `proj_demo_path_${suffix}`;
  const apiKeyId = `gak_demo_path_${suffix}`;
  const rawApiKey = `nl_demo_path_${suffix}`;
  const openaiAccountId = `provacc_demo_path_openai_${suffix}`;
  const anthropicAccountId = `provacc_demo_path_anthropic_${suffix}`;
  const openaiModelCatalogId = `mdl_demo_path_openai_${suffix}`;
  const anthropicModelCatalogId = `mdl_demo_path_anthropic_${suffix}`;
  const openaiModelId = `gpt-5-demo-smoke-${suffix}`;
  const anthropicModelId = `claude-demo-smoke-${suffix}`;

  await database.insert(workspaces).values({
    id: workspaceId,
    name: `Demo Path Workspace ${suffix}`,
    slug: `demo-path-${suffix}`,
    status: "active",
    defaultMode: "balanced",
  });

  await database.insert(projects).values({
    id: projectId,
    workspaceId,
    name: `Demo Path Project ${suffix}`,
    slug: `demo-path-project-${suffix}`,
    status: "active",
    defaultMode: "balanced",
  });

  await database.insert(gatewayApiKeys).values({
    id: apiKeyId,
    workspaceId,
    projectId: null,
    name: `Demo Path API Key ${suffix}`,
    keyPrefix: getGatewayApiKeyPrefix(rawApiKey),
    keyHash: hashGatewayApiKey(rawApiKey),
    status: "active",
  });

  await database.insert(providerAccounts).values([
    {
      id: openaiAccountId,
      workspaceId,
      provider: "openai",
      displayName: `OpenAI Demo Path ${suffix}`,
      status: "active",
      encryptedCredentials: encryptProviderCredentials(
        {
          apiKey: `test-provider-openai-demo-path-${suffix}`,
        },
        {
          PROVIDER_CREDENTIALS_SECRET: TEST_PROVIDER_CREDENTIALS_SECRET,
        },
      ),
      testStatus: "configured",
      metadata: {
        credentialUpdatedAt: new Date("2026-03-24T09:00:00.000Z").toISOString(),
      },
    },
    {
      id: anthropicAccountId,
      workspaceId,
      provider: "anthropic",
      displayName: `Anthropic Demo Path ${suffix}`,
      status: "active",
      encryptedCredentials: encryptProviderCredentials(
        {
          apiKey: `test-provider-anthropic-demo-path-${suffix}`,
        },
        {
          PROVIDER_CREDENTIALS_SECRET: TEST_PROVIDER_CREDENTIALS_SECRET,
        },
      ),
      testStatus: "configured",
      metadata: {
        credentialUpdatedAt: new Date("2026-03-24T09:00:00.000Z").toISOString(),
      },
    },
  ]);

  await database.insert(modelCatalog).values([
    {
      id: openaiModelCatalogId,
      provider: "openai",
      modelId: openaiModelId,
      label: `OpenAI Demo Path ${suffix}`,
      status: "active",
      isActive: true,
      supportsChat: true,
      supportsStreaming: false,
      capabilityClasses: ["general", "coding", "reasoning"],
      costTier: "high",
      latencyTier: "slow",
    },
    {
      id: anthropicModelCatalogId,
      provider: "anthropic",
      modelId: anthropicModelId,
      label: `Anthropic Demo Path ${suffix}`,
      status: "active",
      isActive: true,
      supportsChat: true,
      supportsStreaming: false,
      capabilityClasses: ["general", "coding", "reasoning"],
      costTier: "low",
      latencyTier: "fast",
    },
  ]);

  await database.insert(externalModelBenchmarks).values([
    {
      id: `bench_demo_path_openai_${suffix}`,
      sourceName: "artificial_analysis",
      externalStableModelId: `ext_demo_path_openai_${suffix}`,
      modelMappingKey: `openai:${openaiModelId}`,
      modelCatalogId: openaiModelCatalogId,
      provider: "openai",
      modelId: openaiModelId,
      qualityGeneralScore: "95",
      qualityCodingScore: "95",
      priceInputPer1mTokensUsd: "20",
      priceOutputPer1mTokensUsd: "20",
      outputTokensPerSecond: "30",
      timeToFirstTokenMs: "400",
      syncedAt: new Date(BENCHMARK_TIMESTAMP),
    },
    {
      id: `bench_demo_path_anthropic_${suffix}`,
      sourceName: "artificial_analysis",
      externalStableModelId: `ext_demo_path_anthropic_${suffix}`,
      modelMappingKey: `anthropic:${anthropicModelId}`,
      modelCatalogId: anthropicModelCatalogId,
      provider: "anthropic",
      modelId: anthropicModelId,
      qualityGeneralScore: "88",
      qualityCodingScore: "88",
      priceInputPer1mTokensUsd: "4",
      priceOutputPer1mTokensUsd: "4",
      outputTokensPerSecond: "90",
      timeToFirstTokenMs: "120",
      syncedAt: new Date(BENCHMARK_TIMESTAMP),
    },
  ]);

  await database.insert(policyRules).values([
    {
      id: `pol_demo_path_allow_models_${suffix}`,
      workspaceId,
      projectId,
      name: `Allow only demo smoke models ${suffix}`,
      ruleType: "allow_model",
      status: "active",
      enforcementMode: "hard_block",
      conditionsJson: {
        version: 1,
        models: [openaiModelId, anthropicModelId],
        reason:
          "Demo smoke routing is constrained to the isolated fixture models.",
      },
    },
    {
      id: `pol_demo_path_budget_cap_${suffix}`,
      workspaceId,
      projectId,
      name: `Budget cap for demo smoke ${suffix}`,
      ruleType: "budget_cap",
      status: "active",
      enforcementMode: "hard_block",
      conditionsJson: {
        version: 1,
        when: {
          modes: ["budget"],
        },
        limitUsd: EXPECTED_RECORDED_COST_USD,
        reason:
          "Budget mode should block once the success path has recorded internal spend.",
      },
    },
  ]);

  return {
    workspaceId,
    projectId,
    apiKeyId,
    rawApiKey,
    openaiAccountId,
    anthropicAccountId,
    openaiModelCatalogId,
    anthropicModelCatalogId,
    openaiModelId,
    anthropicModelId,
  };
}

async function cleanupDemoFixture(database: Database, fixture: DemoFixture) {
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
    .delete(policyRules)
    .where(eq(policyRules.workspaceId, fixture.workspaceId));
  await database
    .delete(gatewayApiKeys)
    .where(eq(gatewayApiKeys.workspaceId, fixture.workspaceId));
  await database
    .delete(providerAccounts)
    .where(eq(providerAccounts.workspaceId, fixture.workspaceId));
  await database
    .delete(externalModelBenchmarks)
    .where(
      and(
        eq(
          externalModelBenchmarks.modelCatalogId,
          fixture.openaiModelCatalogId,
        ),
        eq(externalModelBenchmarks.sourceName, "artificial_analysis"),
      ),
    );
  await database
    .delete(externalModelBenchmarks)
    .where(
      and(
        eq(
          externalModelBenchmarks.modelCatalogId,
          fixture.anthropicModelCatalogId,
        ),
        eq(externalModelBenchmarks.sourceName, "artificial_analysis"),
      ),
    );
  await database
    .delete(modelCatalog)
    .where(eq(modelCatalog.id, fixture.openaiModelCatalogId));
  await database
    .delete(modelCatalog)
    .where(eq(modelCatalog.id, fixture.anthropicModelCatalogId));
  await database.delete(projects).where(eq(projects.id, fixture.projectId));
  await database
    .delete(workspaces)
    .where(eq(workspaces.id, fixture.workspaceId));
}

test("gateway demo-path smoke verifies the Sprint 1 runtime slice end to end", async (t) => {
  const connection = await openIntegrationDatabase(t);

  if (!connection) {
    return;
  }

  const suffix = randomUUID().slice(0, 8);
  const fixture = await createDemoFixture(connection.db, suffix);
  const successRequestId = `req_demo_path_success_${suffix}`;
  const blockedRequestId = `req_demo_path_blocked_${suffix}`;
  const timeoutRequestId = `req_demo_path_timeout_${suffix}`;
  const providerTransportCalls: ProviderTransportCall[] = [];
  const unexpectedFetchCalls: string[] = [];
  const originalFetch = globalThis.fetch;
  let app: ReturnType<typeof createGatewayApp> | null = null;

  globalThis.fetch = (async (input) => {
    unexpectedFetchCalls.push(String(input));
    throw new Error(
      `Unexpected live fetch in request handling: ${String(input)}`,
    );
  }) as typeof fetch;

  try {
    const anthropicAdapter = createAnthropicAdapter({
      baseUrl: ANTHROPIC_BASE_URL,
      fetch: async (input, init) => {
        providerTransportCalls.push({
          provider: "anthropic",
          url: String(input),
          headers: headersToObject(init?.headers),
          body: parseJsonBody(init?.body),
        });

        return createJsonResponse(
          {
            id: `msg_demo_path_${suffix}`,
            model: fixture.anthropicModelId,
            content: [
              {
                type: "text",
                text: "Anthropic demo response.",
              },
            ],
            stop_reason: "end_turn",
            usage: {
              input_tokens: SUCCESS_INPUT_TOKENS,
              output_tokens: SUCCESS_OUTPUT_TOKENS,
            },
          },
          {
            headers: {
              "content-type": "application/json",
              "request-id": `anthropic_provider_req_${suffix}`,
            },
          },
        );
      },
    });
    const openAiAdapter = createOpenAIAdapter({
      baseUrl: OPENAI_BASE_URL,
      timeoutMs: 5,
      fetch: async (input, init) => {
        providerTransportCalls.push({
          provider: "openai",
          url: String(input),
          headers: headersToObject(init?.headers),
          body: parseJsonBody(init?.body),
        });

        return new Promise((_resolve, reject) => {
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
        });
      },
    });
    const authService = createDatabaseGatewayAuthService();
    const runtime = createChatCompletionsRuntime({
      authService,
      router: createDatabaseChatRouter({
        loadProviderAccounts: async (workspaceId) =>
          listActiveWorkspaceProviderAccounts(workspaceId, connection.db),
        loadPolicyRules: async (input) =>
          listActiveScopedPolicyRules(input, connection.db),
        loadRoutingProfile: async (input) =>
          resolveRoutingProfileForProject(input, connection.db),
        loadCatalogWithBenchmarks: async (input) =>
          listActiveChatModelCatalogWithLatestBenchmarks(input, connection.db),
        loadRecordedCostForPeriod: async (input) =>
          getWorkspaceRecordedCostForPeriod(input, connection.db),
      }),
      providerExecutor: createDatabaseChatProviderExecutor({
        getAdapter: (provider) => {
          switch (provider) {
            case "anthropic":
              return anthropicAdapter;
            case "openai":
              return openAiAdapter;
          }
        },
        loadProviderConfig: async (input) =>
          resolveProviderAccountExecutionConfig(input, connection.db),
        updateProviderPosture: async (input) =>
          updateProviderAccountRuntimePosture(input, connection.db),
      }),
      persistence: createDatabaseChatPersistence({
        database: connection.db,
      }),
    });

    app = createGatewayApp({
      authService,
      chatRuntime: runtime,
      logger: false,
    });

    const successResponse = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: {
        authorization: `Bearer ${fixture.rawApiKey}`,
        "x-request-id": successRequestId,
      },
      payload: {
        project_id: fixture.projectId,
        mode: "balanced",
        task_type: "general",
        stream: false,
        metadata: {
          scenario: "success",
        },
        messages: [
          {
            role: "user",
            content: "Run the successful demo path.",
          },
        ],
      },
    });

    assert.equal(successResponse.statusCode, 200);
    assert.deepEqual(successResponse.json(), {
      id: successRequestId,
      object: "chat.completion",
      created: successResponse.json().created,
      model: fixture.anthropicModelId,
      provider: "anthropic",
      mode: "balanced",
      task_type: "general",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: "Anthropic demo response.",
          },
          finish_reason: "end_turn",
        },
      ],
      usage: {
        input_tokens: SUCCESS_INPUT_TOKENS,
        output_tokens: SUCCESS_OUTPUT_TOKENS,
        total_tokens: SUCCESS_INPUT_TOKENS + SUCCESS_OUTPUT_TOKENS,
      },
      meta: {
        workspace_id: fixture.workspaceId,
        project_id: fixture.projectId,
        latency_ms: successResponse.json().meta.latency_ms,
        selection_reason: {
          code: "best_score_for_mode",
          text: `Selected anthropic/${fixture.anthropicModelId} because it had the best balanced score across policy-eligible candidates.`,
        },
        cost_usd: EXPECTED_RECORDED_COST_USD,
        cost_source: "estimated",
      },
    });
    assert.equal(typeof successResponse.json().meta.latency_ms, "number");

    const blockedResponse = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: {
        authorization: `Bearer ${fixture.rawApiKey}`,
        "x-request-id": blockedRequestId,
      },
      payload: {
        project_id: fixture.projectId,
        mode: "budget",
        task_type: "general",
        stream: false,
        metadata: {
          scenario: "blocked",
        },
        messages: [
          {
            role: "user",
            content: "Run the blocked demo path.",
          },
        ],
      },
    });

    assert.equal(blockedResponse.statusCode, 403);
    assert.deepEqual(blockedResponse.json(), {
      error: {
        type: "policy_blocked",
        code: "workspace_budget_exceeded",
        message:
          "Blocked because the workspace monthly gateway-recorded budget cap has already been reached.",
        request_id: blockedRequestId,
      },
    });

    const timeoutResponse = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: {
        authorization: `Bearer ${fixture.rawApiKey}`,
        "x-request-id": timeoutRequestId,
      },
      payload: {
        project_id: fixture.projectId,
        mode: "max_quality",
        task_type: "general",
        stream: false,
        metadata: {
          scenario: "timeout",
        },
        messages: [
          {
            role: "user",
            content: "Run the timeout demo path.",
          },
        ],
      },
    });

    assert.equal(timeoutResponse.statusCode, 504);
    assert.deepEqual(timeoutResponse.json(), {
      error: {
        type: "timeout",
        code: "provider_timeout",
        message: "OpenAI request timed out.",
        request_id: timeoutRequestId,
      },
    });

    assert.deepEqual(unexpectedFetchCalls, []);
    assert.equal(providerTransportCalls.length, 2);
    assert.deepEqual(
      providerTransportCalls.map((call) => call.url),
      [`${ANTHROPIC_BASE_URL}/messages`, `${OPENAI_BASE_URL}/chat/completions`],
    );

    const anthropicCall = providerTransportCalls[0];
    const openaiCall = providerTransportCalls[1];

    assert.equal(anthropicCall?.provider, "anthropic");
    assert.equal(
      anthropicCall?.headers["x-api-key"],
      `test-provider-anthropic-demo-path-${suffix}`,
    );
    assert.equal(
      anthropicCall?.headers["x-client-request-id"],
      successRequestId,
    );
    assert.equal(anthropicCall?.body.model, fixture.anthropicModelId);
    assert.equal(anthropicCall?.body.stream, false);

    assert.equal(openaiCall?.provider, "openai");
    assert.equal(
      openaiCall?.headers.authorization,
      `Bearer test-provider-openai-demo-path-${suffix}`,
    );
    assert.equal(openaiCall?.headers["x-client-request-id"], timeoutRequestId);
    assert.equal(openaiCall?.body.model, fixture.openaiModelId);
    assert.equal(openaiCall?.body.stream, false);

    const requestRows = await connection.db.query.requests.findMany({
      where: (table, { eq }) => eq(table.workspaceId, fixture.workspaceId),
      orderBy: (table, { asc }) => [asc(table.startedAt), asc(table.id)],
    });
    const attemptRows = await connection.db.query.requestAttempts.findMany({
      where: (table, { eq }) => eq(table.workspaceId, fixture.workspaceId),
      orderBy: (table, { asc }) => [asc(table.startedAt), asc(table.id)],
    });
    const usageRows = await connection.db.query.usageRecords.findMany({
      where: (table, { eq }) => eq(table.workspaceId, fixture.workspaceId),
      orderBy: (table, { asc }) => [asc(table.recordedAt), asc(table.id)],
    });
    const auditRows = await connection.db.query.auditEvents.findMany({
      where: (table, { and, eq }) =>
        and(
          eq(table.workspaceId, fixture.workspaceId),
          eq(table.entityType, "request"),
        ),
      orderBy: (table, { asc }) => [asc(table.createdAt), asc(table.id)],
    });
    const requestById = new Map(requestRows.map((row) => [row.id, row]));
    const attemptsByRequestId = new Map(
      attemptRows.map((row) => [row.requestId, row]),
    );

    assert.equal(requestRows.length, 3);
    assert.equal(attemptRows.length, 2);
    assert.equal(usageRows.length, 1);
    assert.equal(auditRows.length, 6);

    const storedSuccessRequest = requestById.get(successRequestId);
    const storedBlockedRequest = requestById.get(blockedRequestId);
    const storedTimeoutRequest = requestById.get(timeoutRequestId);
    const storedSuccessAttempt = attemptsByRequestId.get(successRequestId);
    const storedTimeoutAttempt = attemptsByRequestId.get(timeoutRequestId);
    const storedUsage = usageRows[0];

    assert.ok(storedSuccessRequest);
    assert.ok(storedBlockedRequest);
    assert.ok(storedTimeoutRequest);
    assert.ok(storedSuccessAttempt);
    assert.ok(storedTimeoutAttempt);
    assert.ok(storedUsage);

    assert.equal(storedSuccessRequest?.status, "succeeded");
    assert.equal(storedBlockedRequest?.status, "blocked");
    assert.equal(storedTimeoutRequest?.status, "failed");
    assert.deepEqual(storedSuccessRequest?.requestMetadata, {
      scenario: "success",
    });
    assert.deepEqual(storedBlockedRequest?.requestMetadata, {
      scenario: "blocked",
    });
    assert.deepEqual(storedTimeoutRequest?.requestMetadata, {
      scenario: "timeout",
    });
    assert.equal(
      (
        storedSuccessRequest?.normalizedRequestJson as {
          prompt_redacted?: boolean;
          message_count?: number;
          metadata_keys?: string[];
          messages?: unknown;
        }
      )?.prompt_redacted,
      true,
    );
    assert.equal(
      (
        storedSuccessRequest?.normalizedRequestJson as {
          prompt_redacted?: boolean;
          message_count?: number;
          metadata_keys?: string[];
          messages?: unknown;
        }
      )?.message_count,
      1,
    );
    assert.deepEqual(
      (
        storedSuccessRequest?.normalizedRequestJson as {
          prompt_redacted?: boolean;
          message_count?: number;
          metadata_keys?: string[];
          messages?: unknown;
        }
      )?.metadata_keys,
      ["scenario"],
    );
    assert.equal(
      "messages" in
        ((storedSuccessRequest?.normalizedRequestJson as Record<
          string,
          unknown
        >) ?? {}),
      false,
    );

    assert.equal(storedSuccessAttempt?.status, "succeeded");
    assert.equal(storedSuccessAttempt?.provider, "anthropic");
    assert.equal(storedSuccessAttempt?.modelId, fixture.anthropicModelId);
    assert.equal(
      storedSuccessAttempt?.providerAccountId,
      fixture.anthropicAccountId,
    );
    assert.equal(
      storedSuccessAttempt?.modelCatalogId,
      fixture.anthropicModelCatalogId,
    );
    assert.equal(storedSuccessAttempt?.errorCode, null);

    assert.equal(storedTimeoutAttempt?.status, "timeout");
    assert.equal(storedTimeoutAttempt?.provider, "openai");
    assert.equal(storedTimeoutAttempt?.modelId, fixture.openaiModelId);
    assert.equal(
      storedTimeoutAttempt?.providerAccountId,
      fixture.openaiAccountId,
    );
    assert.equal(
      storedTimeoutAttempt?.modelCatalogId,
      fixture.openaiModelCatalogId,
    );
    assert.equal(storedTimeoutAttempt?.errorType, "timeout");
    assert.equal(storedTimeoutAttempt?.errorCode, "provider_timeout");
    assert.equal(attemptsByRequestId.has(blockedRequestId), false);

    assert.equal(storedUsage?.requestId, successRequestId);
    assert.equal(storedUsage?.provider, "anthropic");
    assert.equal(storedUsage?.modelId, fixture.anthropicModelId);
    assert.equal(storedUsage?.usageSource, "estimated");
    assert.equal(
      storedUsage?.totalTokens,
      SUCCESS_INPUT_TOKENS + SUCCESS_OUTPUT_TOKENS,
    );
    assert.equal(Number(storedUsage?.costInput ?? 0), 4);
    assert.equal(Number(storedUsage?.costOutput ?? 0), 2);
    assert.equal(
      Number(storedUsage?.costTotal ?? 0),
      EXPECTED_RECORDED_COST_USD,
    );
    assert.equal(
      storedUsage?.pricingVersion,
      `artificial_analysis:${BENCHMARK_TIMESTAMP}`,
    );

    const blockedAuditRow = auditRows.find(
      (row) =>
        row.entityId === blockedRequestId &&
        row.eventType === "chat.completions.blocked",
    );
    const completedAuditRow = auditRows.find(
      (row) =>
        row.entityId === successRequestId &&
        row.eventType === "chat.completions.completed",
    );
    const failedAuditRow = auditRows.find(
      (row) =>
        row.entityId === timeoutRequestId &&
        row.eventType === "chat.completions.failed",
    );

    assert.ok(blockedAuditRow);
    assert.ok(completedAuditRow);
    assert.ok(failedAuditRow);
    assert.equal(
      (
        blockedAuditRow?.eventPayload as {
          metadata?: {
            error_code?: string;
            current_spend_usd?: number;
            limit_usd?: number;
            usage_recorded?: boolean;
          };
        }
      )?.metadata?.error_code,
      "policy_blocked_budget_cap",
    );
    assert.equal(
      (
        blockedAuditRow?.eventPayload as {
          metadata?: {
            error_code?: string;
            current_spend_usd?: number;
            limit_usd?: number;
            usage_recorded?: boolean;
          };
        }
      )?.metadata?.current_spend_usd,
      EXPECTED_RECORDED_COST_USD,
    );
    assert.equal(
      (
        blockedAuditRow?.eventPayload as {
          metadata?: {
            error_code?: string;
            current_spend_usd?: number;
            limit_usd?: number;
            usage_recorded?: boolean;
          };
        }
      )?.metadata?.limit_usd,
      EXPECTED_RECORDED_COST_USD,
    );
    assert.equal(
      (
        blockedAuditRow?.eventPayload as {
          metadata?: {
            error_code?: string;
            current_spend_usd?: number;
            limit_usd?: number;
            usage_recorded?: boolean;
          };
        }
      )?.metadata?.usage_recorded,
      false,
    );
    assert.equal(
      (
        completedAuditRow?.eventPayload as {
          metadata?: {
            request_status?: string;
            usage_recorded?: boolean;
            usage_source?: string;
            cost_total_usd?: number;
          };
        }
      )?.metadata?.request_status,
      "succeeded",
    );
    assert.equal(
      (
        completedAuditRow?.eventPayload as {
          metadata?: {
            request_status?: string;
            usage_recorded?: boolean;
            usage_source?: string;
            cost_total_usd?: number;
          };
        }
      )?.metadata?.usage_recorded,
      true,
    );
    assert.equal(
      (
        completedAuditRow?.eventPayload as {
          metadata?: {
            request_status?: string;
            usage_recorded?: boolean;
            usage_source?: string;
            cost_total_usd?: number;
          };
        }
      )?.metadata?.usage_source,
      "estimated",
    );
    assert.equal(
      (
        completedAuditRow?.eventPayload as {
          metadata?: {
            request_status?: string;
            usage_recorded?: boolean;
            usage_source?: string;
            cost_total_usd?: number;
          };
        }
      )?.metadata?.cost_total_usd,
      EXPECTED_RECORDED_COST_USD,
    );
    assert.equal(
      (
        failedAuditRow?.eventPayload as {
          metadata?: {
            request_status?: string;
            error_code?: string;
            usage_recorded?: boolean;
            cost_unavailable?: boolean;
          };
        }
      )?.metadata?.request_status,
      "failed",
    );
    assert.equal(
      (
        failedAuditRow?.eventPayload as {
          metadata?: {
            request_status?: string;
            error_code?: string;
            usage_recorded?: boolean;
            cost_unavailable?: boolean;
          };
        }
      )?.metadata?.error_code,
      "provider_timeout",
    );
    assert.equal(
      (
        failedAuditRow?.eventPayload as {
          metadata?: {
            request_status?: string;
            error_code?: string;
            usage_recorded?: boolean;
            cost_unavailable?: boolean;
          };
        }
      )?.metadata?.usage_recorded,
      false,
    );
    assert.equal(
      (
        failedAuditRow?.eventPayload as {
          metadata?: {
            request_status?: string;
            error_code?: string;
            usage_recorded?: boolean;
            cost_unavailable?: boolean;
          };
        }
      )?.metadata?.cost_unavailable,
      true,
    );

    const monthRange = getUtcMonthRange();
    const overviewStats = await getWorkspaceOverviewStats(
      {
        workspaceId: fixture.workspaceId,
        start: monthRange.start,
        end: monthRange.end,
      },
      connection.db,
    );
    const requestSummaries = await listRecentWorkspaceRequests(
      {
        workspaceId: fixture.workspaceId,
        limit: 10,
      },
      connection.db,
    );
    const auditSummaries = await listRecentWorkspaceAuditEvents(
      {
        workspaceId: fixture.workspaceId,
        limit: 10,
      },
      connection.db,
    );
    const providerSummaries = await listProviderStatusSummaries(
      fixture.workspaceId,
      connection.db,
    );
    const apiKeySummaries = await listActiveGatewayApiKeySummaries(
      fixture.workspaceId,
      connection.db,
    );

    assert.equal(overviewStats.requestCount, 3);
    assert.equal(overviewStats.blockedCount, 1);
    assert.equal(overviewStats.failedCount, 1);
    assert.equal(overviewStats.succeededCount, 1);
    assert.equal(overviewStats.usageRecordCount, 1);
    assert.equal(
      overviewStats.totalTokens,
      SUCCESS_INPUT_TOKENS + SUCCESS_OUTPUT_TOKENS,
    );
    assert.equal(overviewStats.totalCostUsd, EXPECTED_RECORDED_COST_USD);

    assert.equal(requestSummaries.length, 3);
    const successSummary = requestSummaries.find(
      (summary) => summary.id === successRequestId,
    );
    const blockedSummary = requestSummaries.find(
      (summary) => summary.id === blockedRequestId,
    );
    const timeoutSummary = requestSummaries.find(
      (summary) => summary.id === timeoutRequestId,
    );

    assert.ok(successSummary);
    assert.ok(blockedSummary);
    assert.ok(timeoutSummary);
    assert.equal(successSummary?.status, "succeeded");
    assert.equal(successSummary?.routing.selectedProvider, "anthropic");
    assert.equal(
      successSummary?.routing.selectedModel,
      fixture.anthropicModelId,
    );
    assert.equal(successSummary?.requestEnvelope.promptRedacted, true);
    assert.equal(
      successSummary?.usage?.costTotalUsd,
      EXPECTED_RECORDED_COST_USD,
    );

    assert.equal(blockedSummary?.status, "blocked");
    assert.equal(blockedSummary?.latestAttempt, null);
    assert.equal(
      blockedSummary?.outcome.errorCode,
      "policy_blocked_budget_cap",
    );
    assert.equal(blockedSummary?.outcome.costTotalUsd, 0);

    assert.equal(timeoutSummary?.status, "failed");
    assert.equal(timeoutSummary?.latestAttempt?.status, "timeout");
    assert.equal(timeoutSummary?.latestAttempt?.provider, "openai");
    assert.equal(timeoutSummary?.routing.selectedProvider, "openai");
    assert.equal(timeoutSummary?.outcome.errorCode, "provider_timeout");

    assert.equal(auditSummaries.length, 6);
    const blockedAuditSummary = auditSummaries.find(
      (summary) =>
        summary.entityId === blockedRequestId &&
        summary.eventType === "chat.completions.blocked",
    );
    const completedAuditSummary = auditSummaries.find(
      (summary) =>
        summary.entityId === successRequestId &&
        summary.eventType === "chat.completions.completed",
    );
    const failedAuditSummary = auditSummaries.find(
      (summary) =>
        summary.entityId === timeoutRequestId &&
        summary.eventType === "chat.completions.failed",
    );

    assert.equal(blockedAuditSummary?.requestStatus, "blocked");
    assert.equal(blockedAuditSummary?.errorCode, "policy_blocked_budget_cap");
    assert.equal(completedAuditSummary?.requestStatus, "succeeded");
    assert.equal(completedAuditSummary?.provider, "anthropic");
    assert.equal(
      completedAuditSummary?.costTotalUsd,
      EXPECTED_RECORDED_COST_USD,
    );
    assert.equal(failedAuditSummary?.requestStatus, "failed");
    assert.equal(failedAuditSummary?.provider, "openai");
    assert.equal(failedAuditSummary?.errorCode, "provider_timeout");

    assert.equal(providerSummaries.length, 2);
    const anthropicSummary = providerSummaries.find(
      (summary) => summary.provider === "anthropic",
    );
    const openaiSummary = providerSummaries.find(
      (summary) => summary.provider === "openai",
    );

    assert.ok(anthropicSummary);
    assert.ok(openaiSummary);
    assert.equal(anthropicSummary?.credentialState, "stored");
    assert.equal(anthropicSummary?.readiness, "ready");
    assert.equal(anthropicSummary?.latestAttempt?.status, "succeeded");
    assert.equal(anthropicSummary?.account?.testStatus, "ready");
    assert.equal(openaiSummary?.credentialState, "stored");
    assert.equal(openaiSummary?.readiness, "attention");
    assert.equal(openaiSummary?.latestAttempt?.status, "timeout");
    assert.equal(openaiSummary?.latestAttempt?.errorCode, "provider_timeout");
    assert.equal(openaiSummary?.account?.testStatus, "timeout");

    assert.equal(apiKeySummaries.length, 1);
    assert.equal(apiKeySummaries[0]?.id, fixture.apiKeyId);
    assert.equal(
      apiKeySummaries[0]?.keyPrefix,
      getGatewayApiKeyPrefix(fixture.rawApiKey),
    );
    assert.equal(apiKeySummaries[0]?.project, null);
    assert.equal(typeof apiKeySummaries[0]?.lastUsedAt, "string");

    const [storedApiKey] = await connection.db
      .select({
        lastUsedAt: gatewayApiKeys.lastUsedAt,
      })
      .from(gatewayApiKeys)
      .where(eq(gatewayApiKeys.id, fixture.apiKeyId))
      .limit(1);

    assert.ok(storedApiKey?.lastUsedAt);
    assert.equal(
      apiKeySummaries[0]?.lastUsedAt,
      storedApiKey?.lastUsedAt?.toISOString(),
    );
  } finally {
    globalThis.fetch = originalFetch;

    if (app) {
      await app.close();
    }

    await cleanupDemoFixture(connection.db, fixture);
  }
});
