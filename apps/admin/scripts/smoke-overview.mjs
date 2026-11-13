#!/usr/bin/env node

import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";

import {
  loadAdminBootstrapEnv,
  resolveAdminBootstrapPaths,
} from "./run-next.mjs";
import {
  closeBrowserTarget,
  createPageClient,
  createSmokeCommandEnv,
  createSmokeError,
  createSmokeLogger,
  createWorkspaceRequire,
  formatManagedProcessLogs,
  getCorepackCommand,
  getFreePort,
  killProcessTree,
  openBrowserTarget,
  PAGE_ASSERTION_TIMEOUT_MS,
  PAGE_NAVIGATION_TIMEOUT_MS,
  resolveBrowserExecutablePath,
  runCheckedCommand,
  startBrowserProcess,
  startManagedProcess,
  waitFor,
  waitForDevToolsReady,
  waitForServerReady,
} from "./smoke-helpers.mjs";

const requireWorkspace = createWorkspaceRequire(import.meta.url);

const BUILD_PACKAGES = [
  "@neuralayer/config",
  "@neuralayer/core",
  "@neuralayer/provider-adapters",
  "@neuralayer/db",
  "@neuralayer/gateway",
  "@neuralayer/admin",
];
const DEMO_ADMIN_WORKSPACE_ID = "ws_demo";

const PROVIDERS_UNDER_TEST = ["openai", "anthropic"];
const BENCHMARK_SOURCE_NAME = "artificial_analysis";
const BENCHMARK_SNAPSHOT_AT = new Date("2099-04-01T00:00:00.000Z");
const SUCCESS_INPUT_TOKENS = 1_000_000;
const SUCCESS_OUTPUT_TOKENS = 500_000;

const BENCHMARK_FIXTURES = {
  "openai:gpt-5.2": {
    qualityGeneralScore: "95",
    qualityCodingScore: "95",
    priceInputPer1mTokensUsd: "20",
    priceOutputPer1mTokensUsd: "20",
    outputTokensPerSecond: "30",
    timeToFirstTokenMs: "400",
  },
  "openai:gpt-5-mini": {
    qualityGeneralScore: "90",
    qualityCodingScore: "90",
    priceInputPer1mTokensUsd: "10",
    priceOutputPer1mTokensUsd: "10",
    outputTokensPerSecond: "60",
    timeToFirstTokenMs: "180",
  },
  "openai:gpt-5-nano": {
    qualityGeneralScore: "65",
    qualityCodingScore: "60",
    priceInputPer1mTokensUsd: "1",
    priceOutputPer1mTokensUsd: "1",
    outputTokensPerSecond: "110",
    timeToFirstTokenMs: "70",
  },
  "anthropic:claude-opus-4-1-20250805": {
    qualityGeneralScore: "93",
    qualityCodingScore: "93",
    priceInputPer1mTokensUsd: "18",
    priceOutputPer1mTokensUsd: "18",
    outputTokensPerSecond: "25",
    timeToFirstTokenMs: "500",
  },
  "anthropic:claude-sonnet-4-20250514": {
    qualityGeneralScore: "88",
    qualityCodingScore: "85",
    priceInputPer1mTokensUsd: "4",
    priceOutputPer1mTokensUsd: "4",
    outputTokensPerSecond: "90",
    timeToFirstTokenMs: "120",
  },
  "anthropic:claude-3-5-haiku-20241022": {
    qualityGeneralScore: "72",
    qualityCodingScore: "70",
    priceInputPer1mTokensUsd: "2",
    priceOutputPer1mTokensUsd: "2",
    outputTokensPerSecond: "100",
    timeToFirstTokenMs: "90",
  },
};

const MODE_ALLOW_MODEL_POOLS = {
  balanced: ["anthropic:claude-sonnet-4-20250514", "openai:gpt-5-mini"],
  max_quality: ["openai:gpt-5.2", "anthropic:claude-opus-4-1-20250805"],
  budget: ["openai:gpt-5-nano", "anthropic:claude-3-5-haiku-20241022"],
};

const logStep = createSmokeLogger("admin:smoke:overview");

function loadConfigModule() {
  return requireWorkspace("@neuralayer/config");
}

function loadDbModule() {
  return requireWorkspace("@neuralayer/db");
}

function loadDrizzleModule() {
  return createWorkspaceRequire(requireWorkspace.resolve("@neuralayer/db"))(
    "drizzle-orm",
  );
}

function loadProviderAdaptersModule() {
  return requireWorkspace("@neuralayer/provider-adapters");
}

function loadGatewayRuntimeModules(repoRootDir) {
  const gatewayDistDir = resolve(repoRootDir, "apps/gateway/dist");

  return {
    ...requireWorkspace(resolve(gatewayDistDir, "app.js")),
    ...requireWorkspace(resolve(gatewayDistDir, "modules/auth/context.js")),
    ...requireWorkspace(resolve(gatewayDistDir, "modules/chat/runtime.js")),
    ...requireWorkspace(resolve(gatewayDistDir, "modules/chat/router.js")),
    ...requireWorkspace(
      resolve(gatewayDistDir, "modules/chat/provider-executor.js"),
    ),
    ...requireWorkspace(resolve(gatewayDistDir, "modules/chat/persistence.js")),
  };
}

function getUtcMonthRange(now = new Date()) {
  return {
    start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
    end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
  };
}

function buildAllowModelRule(input) {
  return {
    id: input.id,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    name: `Smoke allow-list for ${input.mode}`,
    ruleType: "allow_model",
    status: "active",
    enforcementMode: "hard_block",
    conditionsJson: {
      version: 1,
      when: {
        modes: [input.mode],
      },
      models: input.models,
      reason: `Smoke route for ${input.mode} stays constrained to a deterministic candidate pair.`,
    },
    createdAt: input.now,
    updatedAt: input.now,
  };
}

function buildBenchmarkPayload(input) {
  return {
    id: input.id,
    sourceName: BENCHMARK_SOURCE_NAME,
    externalStableModelId: `overview-smoke:${input.smokeId}:${input.model.provider}:${input.model.modelId}`,
    modelMappingKey: `overview-smoke:${input.smokeId}:${input.model.id}`,
    modelCatalogId: input.model.id,
    provider: input.model.provider,
    modelId: input.model.modelId,
    qualityGeneralScore: input.spec.qualityGeneralScore,
    qualityCodingScore: input.spec.qualityCodingScore,
    priceInputPer1mTokensUsd: input.spec.priceInputPer1mTokensUsd,
    priceOutputPer1mTokensUsd: input.spec.priceOutputPer1mTokensUsd,
    outputTokensPerSecond: input.spec.outputTokensPerSecond,
    timeToFirstTokenMs: input.spec.timeToFirstTokenMs,
    syncedAt: BENCHMARK_SNAPSHOT_AT,
    rawPayload: {
      smokeFixture: "admin_overview_requests",
      smokeId: input.smokeId,
      provider: input.model.provider,
      modelId: input.model.modelId,
    },
    createdAt: input.now,
    updatedAt: input.now,
  };
}

async function prepareSmokeFixture(input) {
  const dbModule = loadDbModule();
  const drizzleModule = loadDrizzleModule();
  const configModule = loadConfigModule();
  const {
    DEMO_API_KEY_ID,
    DEMO_WORKSPACE_ID,
    createDbConnection,
    encryptProviderCredentials,
    externalModelBenchmarks,
    gatewayApiKeys,
    modelCatalog,
    policyRules,
    projects,
    providerAccounts,
    workspaces,
  } = dbModule;
  const { and, eq, inArray, isNull } = drizzleModule;
  const {
    database: { url },
  } = configModule.loadDatabaseConfig();
  const { db, queryClient } = createDbConnection(url);
  const now = new Date();
  const tempProjectId = randomUUID();
  const tempProjectSlug = `overview-smoke-${input.smokeId}`;
  const tempProjectName = `Overview Smoke ${input.smokeId}`;
  const tempPolicyRuleIds = {
    balanced: randomUUID(),
    max_quality: randomUUID(),
    budget: randomUUID(),
  };
  const tempProviderKeys = {
    openai: `test-provider-openai-overview-smoke-${input.smokeId}`,
    anthropic: `test-provider-anthropic-overview-smoke-${input.smokeId}`,
  };

  const [workspaceRow] = await db
    .select({
      id: workspaces.id,
      defaultRoutingProfileId: workspaces.defaultRoutingProfileId,
    })
    .from(workspaces)
    .where(eq(workspaces.id, DEMO_WORKSPACE_ID))
    .limit(1);

  if (!workspaceRow) {
    throw createSmokeError(
      `Seeded admin workspace ${DEMO_WORKSPACE_ID} is not available.`,
    );
  }

  const [demoApiKeyRow] = await db
    .select()
    .from(gatewayApiKeys)
    .where(eq(gatewayApiKeys.id, DEMO_API_KEY_ID))
    .limit(1);

  if (!demoApiKeyRow) {
    throw createSmokeError(
      `Seeded demo API key ${DEMO_API_KEY_ID} is missing.`,
    );
  }

  const providerRows = await db
    .select()
    .from(providerAccounts)
    .where(
      and(
        eq(providerAccounts.workspaceId, DEMO_WORKSPACE_ID),
        inArray(providerAccounts.provider, PROVIDERS_UNDER_TEST),
      ),
    );

  if (
    !PROVIDERS_UNDER_TEST.every((provider) =>
      providerRows.some((row) => row.provider === provider),
    )
  ) {
    throw createSmokeError(
      `The seeded workspace ${DEMO_WORKSPACE_ID} does not expose both OpenAI and Anthropic provider accounts.`,
    );
  }

  const modelRows = await db
    .select()
    .from(modelCatalog)
    .where(
      and(eq(modelCatalog.status, "active"), eq(modelCatalog.isActive, true)),
    );
  const benchmarkModelRows = modelRows.filter(
    (row) => BENCHMARK_FIXTURES[`${row.provider}:${row.modelId}`],
  );

  if (benchmarkModelRows.length !== Object.keys(BENCHMARK_FIXTURES).length) {
    throw createSmokeError(
      "The seeded model catalog does not match the benchmark fixture set used by the browser smoke.",
    );
  }

  const originalBenchmarkRows = await db
    .select()
    .from(externalModelBenchmarks)
    .where(
      and(
        eq(externalModelBenchmarks.sourceName, BENCHMARK_SOURCE_NAME),
        inArray(
          externalModelBenchmarks.modelCatalogId,
          benchmarkModelRows.map((row) => row.id),
        ),
      ),
    );
  const originalBudgetRules = await db
    .select()
    .from(policyRules)
    .where(
      and(
        eq(policyRules.workspaceId, DEMO_WORKSPACE_ID),
        isNull(policyRules.projectId),
        eq(policyRules.ruleType, "budget_cap"),
        eq(policyRules.enforcementMode, "hard_block"),
      ),
    );

  for (const row of originalBudgetRules) {
    if (row.status !== "active") {
      continue;
    }

    await db
      .update(policyRules)
      .set({
        status: "inactive",
        updatedAt: now,
      })
      .where(eq(policyRules.id, row.id));
  }

  for (const row of providerRows) {
    const encryptedCredentials = encryptProviderCredentials(
      {
        apiKey: tempProviderKeys[row.provider],
      },
      {
        PROVIDER_CREDENTIALS_SECRET: input.providerCredentialsSecret,
      },
    );

    await db
      .update(providerAccounts)
      .set({
        status: "active",
        encryptedCredentials,
        testStatus: "configured",
        lastTestedAt: null,
        metadata: {
          ...(row.metadata ?? {}),
          credentialUpdatedAt: now.toISOString(),
          credentialMask: row.provider === "openai" ? "****osmk" : "****asmk",
          providerKeyLabel:
            row.provider === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY",
        },
        updatedAt: now,
      })
      .where(eq(providerAccounts.id, row.id));
  }

  for (const modelRow of benchmarkModelRows) {
    const spec = BENCHMARK_FIXTURES[`${modelRow.provider}:${modelRow.modelId}`];

    if (!spec) {
      continue;
    }

    const benchmarkPayload = buildBenchmarkPayload({
      id: randomUUID(),
      smokeId: input.smokeId,
      model: modelRow,
      spec,
      now,
    });

    await db
      .insert(externalModelBenchmarks)
      .values(benchmarkPayload)
      .onConflictDoUpdate({
        target: [
          externalModelBenchmarks.sourceName,
          externalModelBenchmarks.modelCatalogId,
        ],
        set: {
          externalStableModelId: benchmarkPayload.externalStableModelId,
          modelMappingKey: benchmarkPayload.modelMappingKey,
          provider: benchmarkPayload.provider,
          modelId: benchmarkPayload.modelId,
          qualityGeneralScore: benchmarkPayload.qualityGeneralScore,
          qualityCodingScore: benchmarkPayload.qualityCodingScore,
          priceInputPer1mTokensUsd: benchmarkPayload.priceInputPer1mTokensUsd,
          priceOutputPer1mTokensUsd: benchmarkPayload.priceOutputPer1mTokensUsd,
          outputTokensPerSecond: benchmarkPayload.outputTokensPerSecond,
          timeToFirstTokenMs: benchmarkPayload.timeToFirstTokenMs,
          syncedAt: benchmarkPayload.syncedAt,
          rawPayload: benchmarkPayload.rawPayload,
          updatedAt: now,
        },
      });
  }

  await db.insert(projects).values({
    id: tempProjectId,
    workspaceId: DEMO_WORKSPACE_ID,
    name: tempProjectName,
    slug: tempProjectSlug,
    description:
      "Temporary admin browser smoke project for Overview and Requests.",
    status: "active",
    defaultMode: "balanced",
    routingProfileId: workspaceRow.defaultRoutingProfileId ?? null,
    metadata: {
      smokeFixture: "admin_overview_requests",
      smokeId: input.smokeId,
    },
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(policyRules).values([
    buildAllowModelRule({
      id: tempPolicyRuleIds.balanced,
      workspaceId: DEMO_WORKSPACE_ID,
      projectId: tempProjectId,
      mode: "balanced",
      models: MODE_ALLOW_MODEL_POOLS.balanced.map(
        (entry) => entry.split(":")[1],
      ),
      now,
    }),
    buildAllowModelRule({
      id: tempPolicyRuleIds.max_quality,
      workspaceId: DEMO_WORKSPACE_ID,
      projectId: tempProjectId,
      mode: "max_quality",
      models: MODE_ALLOW_MODEL_POOLS.max_quality.map(
        (entry) => entry.split(":")[1],
      ),
      now,
    }),
    buildAllowModelRule({
      id: tempPolicyRuleIds.budget,
      workspaceId: DEMO_WORKSPACE_ID,
      projectId: tempProjectId,
      mode: "budget",
      models: MODE_ALLOW_MODEL_POOLS.budget.map((entry) => entry.split(":")[1]),
      now,
    }),
  ]);

  return {
    db,
    queryClient,
    demoApiKeyRow,
    originalBenchmarkRows,
    originalBudgetRules,
    originalProviderRows: providerRows,
    benchmarkModelRows,
    tempProject: {
      id: tempProjectId,
      name: tempProjectName,
      slug: tempProjectSlug,
    },
    tempBudgetRuleId: null,
  };
}

async function restoreSmokeFixture(input) {
  const dbModule = loadDbModule();
  const drizzleModule = loadDrizzleModule();
  const {
    auditEvents,
    externalModelBenchmarks,
    gatewayApiKeys,
    policyRules,
    projects,
    providerAccounts,
    requestAttempts,
    requests,
    usageRecords,
  } = dbModule;
  const { and, eq } = drizzleModule;
  const cleanupSummary = {
    restoredProviderAccounts: 0,
    restoredBenchmarkRows: 0,
    removedBenchmarkRows: 0,
    removedRequestRows: 0,
    removedAttemptRows: 0,
    removedUsageRows: 0,
    removedAuditRows: 0,
    removedPolicyRows: 0,
    removedProject: false,
    restoredBudgetRules: 0,
    restoredDemoApiKey: false,
  };

  try {
    for (const row of input.originalProviderRows ?? []) {
      await input.db
        .update(providerAccounts)
        .set({
          displayName: row.displayName,
          status: row.status,
          encryptedCredentials: row.encryptedCredentials,
          testStatus: row.testStatus,
          lastTestedAt: row.lastTestedAt,
          metadata: row.metadata,
          updatedAt: row.updatedAt,
        })
        .where(eq(providerAccounts.id, row.id));
      cleanupSummary.restoredProviderAccounts += 1;
    }

    const originalBenchmarkRowsByModelCatalogId = new Map(
      (input.originalBenchmarkRows ?? []).map((row) => [
        row.modelCatalogId,
        row,
      ]),
    );

    for (const modelRow of input.benchmarkModelRows ?? []) {
      const originalRow = originalBenchmarkRowsByModelCatalogId.get(
        modelRow.id,
      );

      if (originalRow) {
        await input.db
          .update(externalModelBenchmarks)
          .set({
            externalStableModelId: originalRow.externalStableModelId,
            modelMappingKey: originalRow.modelMappingKey,
            provider: originalRow.provider,
            modelId: originalRow.modelId,
            qualityGeneralScore: originalRow.qualityGeneralScore,
            qualityCodingScore: originalRow.qualityCodingScore,
            priceInputPer1mTokensUsd: originalRow.priceInputPer1mTokensUsd,
            priceOutputPer1mTokensUsd: originalRow.priceOutputPer1mTokensUsd,
            outputTokensPerSecond: originalRow.outputTokensPerSecond,
            timeToFirstTokenMs: originalRow.timeToFirstTokenMs,
            syncedAt: originalRow.syncedAt,
            rawPayload: originalRow.rawPayload,
            updatedAt: originalRow.updatedAt,
          })
          .where(eq(externalModelBenchmarks.id, originalRow.id));
        cleanupSummary.restoredBenchmarkRows += 1;
        continue;
      }

      await input.db
        .delete(externalModelBenchmarks)
        .where(
          and(
            eq(externalModelBenchmarks.sourceName, BENCHMARK_SOURCE_NAME),
            eq(externalModelBenchmarks.modelCatalogId, modelRow.id),
          ),
        );
      cleanupSummary.removedBenchmarkRows += 1;
    }

    if (input.tempBudgetRuleId) {
      const existingBudgetRules = await input.db
        .select({
          id: policyRules.id,
        })
        .from(policyRules)
        .where(eq(policyRules.id, input.tempBudgetRuleId));

      await input.db
        .delete(policyRules)
        .where(eq(policyRules.id, input.tempBudgetRuleId));
      cleanupSummary.removedPolicyRows += existingBudgetRules.length;
    }

    for (const row of input.originalBudgetRules ?? []) {
      await input.db
        .update(policyRules)
        .set({
          name: row.name,
          status: row.status,
          enforcementMode: row.enforcementMode,
          conditionsJson: row.conditionsJson,
          updatedAt: row.updatedAt,
        })
        .where(eq(policyRules.id, row.id));
      cleanupSummary.restoredBudgetRules += 1;
    }

    if (input.tempProject?.id) {
      const [
        existingUsageRows,
        existingAttemptRows,
        existingAuditRows,
        existingRequestRows,
        existingPolicyRows,
        existingProjectRows,
      ] = await Promise.all([
        input.db
          .select({ id: usageRecords.id })
          .from(usageRecords)
          .where(eq(usageRecords.projectId, input.tempProject.id)),
        input.db
          .select({ id: requestAttempts.id })
          .from(requestAttempts)
          .where(eq(requestAttempts.projectId, input.tempProject.id)),
        input.db
          .select({ id: auditEvents.id })
          .from(auditEvents)
          .where(eq(auditEvents.projectId, input.tempProject.id)),
        input.db
          .select({ id: requests.id })
          .from(requests)
          .where(eq(requests.projectId, input.tempProject.id)),
        input.db
          .select({ id: policyRules.id })
          .from(policyRules)
          .where(eq(policyRules.projectId, input.tempProject.id)),
        input.db
          .select({ id: projects.id })
          .from(projects)
          .where(eq(projects.id, input.tempProject.id)),
      ]);

      await input.db
        .delete(usageRecords)
        .where(eq(usageRecords.projectId, input.tempProject.id));
      cleanupSummary.removedUsageRows += existingUsageRows.length;

      await input.db
        .delete(requestAttempts)
        .where(eq(requestAttempts.projectId, input.tempProject.id));
      cleanupSummary.removedAttemptRows += existingAttemptRows.length;

      await input.db
        .delete(auditEvents)
        .where(eq(auditEvents.projectId, input.tempProject.id));
      cleanupSummary.removedAuditRows += existingAuditRows.length;

      await input.db
        .delete(requests)
        .where(eq(requests.projectId, input.tempProject.id));
      cleanupSummary.removedRequestRows += existingRequestRows.length;

      await input.db
        .delete(policyRules)
        .where(eq(policyRules.projectId, input.tempProject.id));
      cleanupSummary.removedPolicyRows += existingPolicyRows.length;

      await input.db
        .delete(projects)
        .where(eq(projects.id, input.tempProject.id));
      cleanupSummary.removedProject = existingProjectRows.length > 0;
    }

    if (input.demoApiKeyRow) {
      await input.db
        .update(gatewayApiKeys)
        .set({
          status: input.demoApiKeyRow.status,
          lastUsedAt: input.demoApiKeyRow.lastUsedAt,
          expiresAt: input.demoApiKeyRow.expiresAt,
          updatedAt: input.demoApiKeyRow.updatedAt,
        })
        .where(eq(gatewayApiKeys.id, input.demoApiKeyRow.id));
      cleanupSummary.restoredDemoApiKey = true;
    }

    return cleanupSummary;
  } finally {
    await input.queryClient?.end({ timeout: 5 }).catch(() => undefined);
  }
}

async function runGatewayTraffic(input) {
  const dbModule = loadDbModule();
  const providerAdaptersModule = loadProviderAdaptersModule();
  const gatewayRuntimeModules = loadGatewayRuntimeModules(input.repoRootDir);
  const {
    createGatewayApp,
    createDatabaseGatewayAuthService,
    createChatCompletionsRuntime,
    createDatabaseChatRouter,
    createDatabaseChatProviderExecutor,
    createDatabaseChatPersistence,
  } = gatewayRuntimeModules;
  const {
    DEMO_API_KEY_RAW,
    DEMO_WORKSPACE_ID,
    getRequestsPageData,
    getWorkspaceRecordedCostForPeriod,
    listActiveChatModelCatalogWithLatestBenchmarks,
    listActiveScopedPolicyRules,
    listActiveWorkspaceProviderAccounts,
    policyRules,
    resolveProviderAccountExecutionConfig,
    resolveRoutingProfileForProject,
    updateProviderAccountRuntimePosture,
  } = dbModule;
  const { createAnthropicAdapter, createOpenAIAdapter } =
    providerAdaptersModule;
  const monthRange = getUtcMonthRange();
  const successRequestId = `req_overview_smoke_success_${input.smokeId}`;
  const timeoutRequestId = `req_overview_smoke_timeout_${input.smokeId}`;
  const blockedRequestId = `req_overview_smoke_blocked_${input.smokeId}`;
  const anthropicAdapter = createAnthropicAdapter({
    baseUrl: "https://anthropic.overview-smoke.test/v1",
    fetch: async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}"));

      return new Response(
        JSON.stringify({
          id: `msg_overview_smoke_${input.smokeId}`,
          model: body.model,
          content: [
            {
              type: "text",
              text: "Overview smoke response.",
            },
          ],
          stop_reason: "end_turn",
          usage: {
            input_tokens: SUCCESS_INPUT_TOKENS,
            output_tokens: SUCCESS_OUTPUT_TOKENS,
          },
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
            "request-id": `anthropic_overview_smoke_${input.smokeId}`,
          },
        },
      );
    },
  });
  const openAiAdapter = createOpenAIAdapter({
    baseUrl: "https://openai.overview-smoke.test/v1",
    timeoutMs: 5,
    fetch: async (_url, init) =>
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
  const authService = createDatabaseGatewayAuthService();
  const runtime = createChatCompletionsRuntime({
    authService,
    router: createDatabaseChatRouter({
      loadProviderAccounts: async (workspaceId) =>
        listActiveWorkspaceProviderAccounts(workspaceId, input.fixture.db),
      loadPolicyRules: async (requestInput) =>
        listActiveScopedPolicyRules(requestInput, input.fixture.db),
      loadRoutingProfile: async (requestInput) =>
        resolveRoutingProfileForProject(requestInput, input.fixture.db),
      loadCatalogWithBenchmarks: async (requestInput) =>
        listActiveChatModelCatalogWithLatestBenchmarks(
          requestInput,
          input.fixture.db,
        ),
      loadRecordedCostForPeriod: async (requestInput) =>
        getWorkspaceRecordedCostForPeriod(requestInput, input.fixture.db),
    }),
    providerExecutor: createDatabaseChatProviderExecutor({
      getAdapter: (provider) => {
        switch (provider) {
          case "anthropic":
            return anthropicAdapter;
          case "openai":
            return openAiAdapter;
          default:
            throw createSmokeError(`Unsupported provider ${provider}.`);
        }
      },
      loadProviderConfig: async (requestInput) =>
        resolveProviderAccountExecutionConfig(requestInput, input.fixture.db),
      updateProviderPosture: async (requestInput) =>
        updateProviderAccountRuntimePosture(requestInput, input.fixture.db),
    }),
    persistence: createDatabaseChatPersistence({
      database: input.fixture.db,
    }),
  });
  const app = createGatewayApp({
    authService,
    chatRuntime: runtime,
    logger: false,
  });

  try {
    logStep(
      "Generating seeded workspace runtime traffic for Overview/Requests",
    );

    const successResponse = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: {
        authorization: `Bearer ${DEMO_API_KEY_RAW}`,
        "x-request-id": successRequestId,
      },
      payload: {
        project_id: input.fixture.tempProject.id,
        mode: "balanced",
        task_type: "general",
        stream: false,
        metadata: {
          smoke: "overview_requests",
          outcome: "success",
        },
        messages: [
          {
            role: "user",
            content: "Run the successful overview smoke path.",
          },
        ],
      },
    });

    if (successResponse.statusCode !== 200) {
      throw createSmokeError(
        `Expected the balanced runtime request to succeed, received HTTP ${successResponse.statusCode}: ${successResponse.body}`,
      );
    }

    const timeoutResponse = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: {
        authorization: `Bearer ${DEMO_API_KEY_RAW}`,
        "x-request-id": timeoutRequestId,
      },
      payload: {
        project_id: input.fixture.tempProject.id,
        mode: "max_quality",
        task_type: "general",
        stream: false,
        metadata: {
          smoke: "overview_requests",
          outcome: "timeout",
        },
        messages: [
          {
            role: "user",
            content: "Run the timeout overview smoke path.",
          },
        ],
      },
    });

    if (timeoutResponse.statusCode !== 504) {
      throw createSmokeError(
        `Expected the max_quality runtime request to time out, received HTTP ${timeoutResponse.statusCode}: ${timeoutResponse.body}`,
      );
    }

    const recordedCost = await getWorkspaceRecordedCostForPeriod(
      {
        workspaceId: DEMO_WORKSPACE_ID,
        start: monthRange.start,
        end: monthRange.end,
      },
      input.fixture.db,
    );
    const budgetLimitUsd = Number(recordedCost.totalCostUsd.toFixed(8));

    if (!Number.isFinite(budgetLimitUsd) || budgetLimitUsd <= 0) {
      throw createSmokeError(
        `The successful runtime request did not persist usable month-to-date cost for ${DEMO_WORKSPACE_ID}.`,
      );
    }

    const budgetRuleId = randomUUID();
    const budgetRuleCreatedAt = new Date();

    await input.fixture.db.insert(policyRules).values({
      id: budgetRuleId,
      workspaceId: DEMO_WORKSPACE_ID,
      projectId: null,
      name: "Smoke workspace budget cap",
      ruleType: "budget_cap",
      status: "active",
      enforcementMode: "hard_block",
      conditionsJson: {
        version: 1,
        limitUsd: budgetLimitUsd,
        reason:
          "Browser smoke should produce a blocked request after a successful runtime request.",
      },
      createdAt: budgetRuleCreatedAt,
      updatedAt: budgetRuleCreatedAt,
    });
    input.fixture.tempBudgetRuleId = budgetRuleId;

    const blockedResponse = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: {
        authorization: `Bearer ${DEMO_API_KEY_RAW}`,
        "x-request-id": blockedRequestId,
      },
      payload: {
        project_id: input.fixture.tempProject.id,
        mode: "budget",
        task_type: "general",
        stream: false,
        metadata: {
          smoke: "overview_requests",
          outcome: "blocked",
        },
        messages: [
          {
            role: "user",
            content: "Run the blocked overview smoke path.",
          },
        ],
      },
    });

    if (blockedResponse.statusCode !== 403) {
      throw createSmokeError(
        `Expected the budget runtime request to block, received HTTP ${blockedResponse.statusCode}: ${blockedResponse.body}`,
      );
    }

    const requestSummary = await getRequestsPageData(
      {
        workspaceId: DEMO_WORKSPACE_ID,
        projectId: input.fixture.tempProject.id,
        limit: 10,
        blockedLimit: 6,
        auditLimit: 6,
      },
      input.fixture.db,
    );
    const feedStatuses = requestSummary.feed.map((item) => item.status);

    if (
      !feedStatuses.includes("succeeded") ||
      !feedStatuses.includes("failed") ||
      !feedStatuses.includes("blocked")
    ) {
      throw createSmokeError(
        `The seeded Requests read model did not expose the expected succeeded/failed/blocked mix: ${JSON.stringify(feedStatuses)}`,
      );
    }

    return {
      successRequestId,
      timeoutRequestId,
      blockedRequestId,
      budgetLimitUsd,
      requestSummary,
    };
  } finally {
    await app.close();
  }
}

async function runOverviewRequestsBrowserSmoke(input) {
  const target = await openBrowserTarget(input.debugPort);
  const page = await createPageClient(target.webSocketDebuggerUrl);
  const passwordLiteral = JSON.stringify(input.password);
  const requestsPath = `/requests?project=${encodeURIComponent(input.project.id)}`;

  try {
    await page.enable();
    await page.navigate(`${input.baseUrl}/login`, "/login");

    const loginHeading = await page.evaluate(
      "document.querySelector('h1')?.textContent?.trim() ?? null",
    );

    if (!loginHeading?.includes("Temporary admin login")) {
      throw createSmokeError(
        "The login page heading did not match the admin gate.",
      );
    }

    await page.evaluate(`(() => {
      const input = document.querySelector('input[name="password"]');

      if (!(input instanceof HTMLInputElement)) {
        throw new Error("password input missing");
      }

      input.focus();
      input.value = ${passwordLiteral};
      input.dispatchEvent(new Event("input", { bubbles: true }));

      const form = input.form;

      if (!form) {
        throw new Error("login form missing");
      }

      form.requestSubmit();
      return true;
    })()`);

    await waitFor(
      async () => {
        const state = await page.evaluate(
          `({ path: location.pathname, ready: document.readyState })`,
        );

        return state.path === "/" && state.ready === "complete" ? state : null;
      },
      PAGE_NAVIGATION_TIMEOUT_MS,
      "post-login redirect",
    );

    await page.navigate(`${input.baseUrl}/`, "/");

    const overviewState = await waitFor(
      async () => {
        const state = await page.evaluate(
          `(() => {
          const text = document.body.innerText;

          return {
            path: location.pathname,
            ready: document.readyState,
            text,
            lower: text.toLowerCase(),
          };
        })()`,
        );

        return state.path === "/" &&
          state.ready === "complete" &&
          state.lower.includes("overview stays intentionally light") &&
          state.lower.includes("open requests") &&
          state.lower.includes("requests mtd") &&
          state.lower.includes("cost mtd") &&
          state.lower.includes("blocked mtd") &&
          state.lower.includes("active providers") &&
          state.lower.includes("recent blocked") &&
          state.lower.includes("recent audit") &&
          state.text.includes(input.project.name) &&
          state.lower.includes("policy_blocked_budget_cap") &&
          state.lower.includes("chat.completions.blocked")
          ? state
          : null;
      },
      PAGE_ASSERTION_TIMEOUT_MS,
      "overview browser assertions",
    );

    const removedSections = [
      "demo entrypoint",
      "gateway api key",
      "provider readiness",
      "recent requests",
    ].filter((value) => overviewState.lower.includes(value));

    if (removedSections.length > 0) {
      throw createSmokeError(
        `Overview still renders removed surfaces: ${removedSections.join(", ")}.`,
      );
    }

    await page.navigate(`${input.baseUrl}${requestsPath}`, "/requests");

    const requestsState = await waitFor(
      async () => {
        const state = await page.evaluate(
          `(() => {
          const text = document.body.innerText;

          return {
            path: location.pathname,
            ready: document.readyState,
            text,
            lower: text.toLowerCase(),
          };
        })()`,
        );

        return state.path === "/requests" &&
          state.ready === "complete" &&
          state.lower.includes("operational request feed") &&
          state.lower.includes("why this happened") &&
          state.text.includes(input.project.name) &&
          state.text.includes(input.requestIds.success) &&
          state.text.includes(input.requestIds.timeout) &&
          state.text.includes(input.requestIds.blocked) &&
          state.lower.includes("provider_timeout") &&
          state.lower.includes("policy_blocked_budget_cap")
          ? state
          : null;
      },
      PAGE_ASSERTION_TIMEOUT_MS,
      "requests browser assertions",
    );

    return {
      loginHeading,
      overviewLightCopyPresent: overviewState.lower.includes(
        "overview stays intentionally light",
      ),
      overviewRemovedSectionsAbsent: removedSections.length === 0,
      overviewProjectPresent: overviewState.text.includes(input.project.name),
      overviewBlockedReasonPresent: overviewState.lower.includes(
        "policy_blocked_budget_cap",
      ),
      overviewRuntimeAuditPresent: overviewState.lower.includes(
        "chat.completions.blocked",
      ),
      requestsFeedPresent: requestsState.lower.includes(
        "operational request feed",
      ),
      requestsProjectPresent: requestsState.text.includes(input.project.name),
      requestsRequestIdsPresent:
        requestsState.text.includes(input.requestIds.success) &&
        requestsState.text.includes(input.requestIds.timeout) &&
        requestsState.text.includes(input.requestIds.blocked),
      requestsTimeoutPresent: requestsState.lower.includes("provider_timeout"),
      requestsBlockedPresent: requestsState.lower.includes(
        "policy_blocked_budget_cap",
      ),
    };
  } finally {
    await page.close();
    await closeBrowserTarget(input.debugPort, target.id);
  }
}

async function main() {
  loadAdminBootstrapEnv({
    importMetaUrl: import.meta.url,
  });

  const { repoRootDir } = resolveAdminBootstrapPaths(import.meta.url);
  const corepackCommand = getCorepackCommand();
  const serverPort = await getFreePort();
  const debugPort = await getFreePort();
  const browserPath = resolveBrowserExecutablePath();
  const browserProfileDir = join(
    tmpdir(),
    `nl-admin-smoke-overview-${Date.now()}`,
  );
  const smokeId = String(Date.now());
  const password = `smoke-${randomBytes(6).toString("hex")}`;
  const sessionSecret = randomBytes(24).toString("hex");
  const providerCredentialsSecret =
    typeof process.env.PROVIDER_CREDENTIALS_SECRET === "string" &&
    process.env.PROVIDER_CREDENTIALS_SECRET.trim().length >= 16
      ? process.env.PROVIDER_CREDENTIALS_SECRET.trim()
      : randomBytes(24).toString("hex");
  const baseUrl = `http://127.0.0.1:${serverPort}`;

  process.env.PROVIDER_CREDENTIALS_SECRET = providerCredentialsSecret;
  mkdirSync(browserProfileDir, { recursive: true });

  let adminServer = null;
  let browserProcess = null;
  let fixture = null;
  let cleanupSummary = null;

  try {
    for (const packageName of BUILD_PACKAGES) {
      await runCheckedCommand(logStep, {
        label: `Building ${packageName}`,
        command: corepackCommand,
        args: ["pnpm", "--filter", packageName, "build"],
        cwd: repoRootDir,
        env: createSmokeCommandEnv(),
      });
    }

    fixture = await prepareSmokeFixture({
      smokeId,
      providerCredentialsSecret,
    });
    const runtimeSummary = await runGatewayTraffic({
      fixture,
      repoRootDir,
      smokeId,
    });

    adminServer = startManagedProcess({
      label: "Admin production server",
      command: corepackCommand,
      args: ["pnpm", "--filter", "@neuralayer/admin", "start"],
      cwd: repoRootDir,
      env: createSmokeCommandEnv({
        ADMIN_ACCESS_PASSWORD: password,
        ADMIN_SESSION_SECRET: sessionSecret,
        ADMIN_PORT: String(serverPort),
        ADMIN_WORKSPACE_ID: DEMO_ADMIN_WORKSPACE_ID,
      }),
    });

    logStep(`Starting admin server on ${baseUrl}`);
    await waitForServerReady({
      baseUrl,
      processInfo: adminServer,
    });

    browserProcess = startBrowserProcess({
      browserPath,
      browserProfileDir,
      debugPort,
    });

    logStep(
      `Starting headless browser ${browserPath} on DevTools port ${debugPort}`,
    );
    await waitForDevToolsReady(debugPort, browserProcess);

    logStep("Running browser-driven Overview and Requests smoke");
    const browserSummary = await runOverviewRequestsBrowserSmoke({
      baseUrl,
      debugPort,
      password,
      project: fixture.tempProject,
      requestIds: {
        success: runtimeSummary.successRequestId,
        timeout: runtimeSummary.timeoutRequestId,
        blocked: runtimeSummary.blockedRequestId,
      },
    });

    cleanupSummary = await restoreSmokeFixture(fixture);

    console.log(
      JSON.stringify(
        {
          project: fixture.tempProject,
          requestIds: {
            success: runtimeSummary.successRequestId,
            timeout: runtimeSummary.timeoutRequestId,
            blocked: runtimeSummary.blockedRequestId,
          },
          dbAssertions: {
            feedStatuses: runtimeSummary.requestSummary.feed.map(
              (item) => item.status,
            ),
            blockedRecentCount:
              runtimeSummary.requestSummary.blockedRecent.length,
            recentAuditCount: runtimeSummary.requestSummary.recentAudit.length,
            budgetLimitUsd: runtimeSummary.budgetLimitUsd,
          },
          browserSummary,
          cleanup: cleanupSummary,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown smoke failure.";

    console.error(`[admin:smoke:overview] ${errorMessage}`);

    if (adminServer) {
      const processLogs = formatManagedProcessLogs(adminServer);

      if (processLogs) {
        console.error(processLogs);
      }
    }

    if (fixture && !cleanupSummary) {
      try {
        cleanupSummary = await restoreSmokeFixture(fixture);
      } catch (cleanupError) {
        const cleanupMessage =
          cleanupError instanceof Error
            ? cleanupError.message
            : "Unknown cleanup failure.";
        console.error(
          `[admin:smoke:overview] Cleanup warning: ${cleanupMessage}`,
        );
      }
    }

    process.exitCode = 1;
  } finally {
    await killProcessTree(browserProcess?.child);
    await killProcessTree(adminServer?.child);
    rmSync(browserProfileDir, {
      recursive: true,
      force: true,
    });
  }
}

main().catch((error) => {
  console.error(
    `[admin:smoke:overview] Fatal error: ${
      error instanceof Error ? (error.stack ?? error.message) : String(error)
    }`,
  );
  process.exit(1);
});
