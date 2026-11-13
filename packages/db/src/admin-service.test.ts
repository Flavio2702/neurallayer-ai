import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { type TestContext, test } from "node:test";

import { loadDatabaseConfig } from "@neuralayer/config";
import { eq } from "drizzle-orm";

import {
  getProviderCredentialState,
  getWorkspaceOverviewStats,
  listActiveGatewayApiKeySummaries,
  listProviderStatusSummaries,
  listRecentWorkspaceAuditEvents,
  listRecentWorkspaceRequests,
  readMaskedProviderCredentialPreview,
  resolveDefaultAdminWorkspace,
  upsertProviderCredentials,
} from "./admin-service";
import { createDbConnection, type Database } from "./client";
import { touchGatewayApiKeyLastUsedAt } from "./gateway-api-key-service";
import {
  encryptProviderCredentials,
  parseProviderCredentialsEnvelope,
} from "./provider-credentials-crypto";
import {
  auditEvents,
  gatewayApiKeys,
  projects,
  providerAccounts,
  requestAttempts,
  requests,
  usageRecords,
  workspaces,
} from "./schema";

const TEST_PROVIDER_CREDENTIALS_SECRET = "provider-credentials-secret-123";

process.env.PROVIDER_CREDENTIALS_SECRET ??= TEST_PROVIDER_CREDENTIALS_SECRET;

type FakeWorkspaceRecord = {
  id: string;
  name: string;
  slug: string;
  status: "active" | "inactive";
  defaultMode: "max_quality" | "balanced" | "budget";
};

type FakeProjectRecord = {
  id: string;
  workspaceId: string;
  name: string;
  slug: string;
  status: "active" | "inactive";
  defaultMode: "max_quality" | "balanced" | "budget";
};

function createFakeAdminDatabase(input: {
  workspaces: FakeWorkspaceRecord[];
  projects?: FakeProjectRecord[];
}) {
  return {
    query: {
      workspaces: {
        async findMany() {
          return input.workspaces;
        },
      },
      projects: {
        async findMany() {
          return input.projects ?? [];
        },
      },
    },
  } as unknown as Database;
}

async function withTemporaryAdminWorkspaceEnv<T>(
  env: {
    ADMIN_WORKSPACE_ID?: string;
    ADMIN_SMOKE_WORKSPACE_ID?: string;
  },
  callback: () => Promise<T>,
) {
  const previousEnv = {
    ADMIN_WORKSPACE_ID: process.env.ADMIN_WORKSPACE_ID,
    ADMIN_SMOKE_WORKSPACE_ID: process.env.ADMIN_SMOKE_WORKSPACE_ID,
  };

  if (env.ADMIN_WORKSPACE_ID === undefined) {
    delete process.env.ADMIN_WORKSPACE_ID;
  } else {
    process.env.ADMIN_WORKSPACE_ID = env.ADMIN_WORKSPACE_ID;
  }

  if (env.ADMIN_SMOKE_WORKSPACE_ID === undefined) {
    delete process.env.ADMIN_SMOKE_WORKSPACE_ID;
  } else {
    process.env.ADMIN_SMOKE_WORKSPACE_ID = env.ADMIN_SMOKE_WORKSPACE_ID;
  }

  try {
    return await callback();
  } finally {
    if (previousEnv.ADMIN_WORKSPACE_ID === undefined) {
      delete process.env.ADMIN_WORKSPACE_ID;
    } else {
      process.env.ADMIN_WORKSPACE_ID = previousEnv.ADMIN_WORKSPACE_ID;
    }

    if (previousEnv.ADMIN_SMOKE_WORKSPACE_ID === undefined) {
      delete process.env.ADMIN_SMOKE_WORKSPACE_ID;
    } else {
      process.env.ADMIN_SMOKE_WORKSPACE_ID =
        previousEnv.ADMIN_SMOKE_WORKSPACE_ID;
    }
  }
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
      `Configured database is unavailable for integration tests: ${
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

test("resolveDefaultAdminWorkspace applies admin workspace targeting precedence and fallback rules", {
  concurrency: false,
}, async () => {
  {
    const database = createFakeAdminDatabase({
      workspaces: [
        {
          id: "ws_demo",
          name: "Demo Workspace",
          slug: "demo-workspace",
          status: "active",
          defaultMode: "balanced",
        },
        {
          id: "ws_pilot",
          name: "Pilot Workspace",
          slug: "pilot-workspace",
          status: "active",
          defaultMode: "max_quality",
        },
      ],
      projects: [
        {
          id: "proj_pilot",
          workspaceId: "ws_pilot",
          name: "Pilot Project",
          slug: "pilot-project",
          status: "active",
          defaultMode: "balanced",
        },
      ],
    });

    const workspaceContext = await withTemporaryAdminWorkspaceEnv(
      {
        ADMIN_WORKSPACE_ID: " ws_pilot ",
      },
      () => resolveDefaultAdminWorkspace(database),
    );

    assert.ok(workspaceContext);
    assert.equal(workspaceContext?.workspace.id, "ws_pilot");
    assert.equal(workspaceContext?.project?.id, "proj_pilot");
  }

  {
    const database = createFakeAdminDatabase({
      workspaces: [
        {
          id: "ws_demo",
          name: "Demo Workspace",
          slug: "demo-workspace",
          status: "active",
          defaultMode: "balanced",
        },
        {
          id: "ws_pilot",
          name: "Pilot Workspace",
          slug: "pilot-workspace",
          status: "active",
          defaultMode: "balanced",
        },
        {
          id: "ws_smoke",
          name: "Smoke Workspace",
          slug: "smoke-workspace",
          status: "active",
          defaultMode: "balanced",
        },
      ],
      projects: [
        {
          id: "proj_smoke",
          workspaceId: "ws_smoke",
          name: "Smoke Project",
          slug: "smoke-project",
          status: "active",
          defaultMode: "balanced",
        },
      ],
    });

    const workspaceContext = await withTemporaryAdminWorkspaceEnv(
      {
        ADMIN_WORKSPACE_ID: "ws_pilot",
        ADMIN_SMOKE_WORKSPACE_ID: "ws_smoke",
      },
      () => resolveDefaultAdminWorkspace(database),
    );

    assert.ok(workspaceContext);
    assert.equal(workspaceContext?.workspace.id, "ws_smoke");
    assert.equal(workspaceContext?.project?.id, "proj_smoke");
  }

  {
    const database = createFakeAdminDatabase({
      workspaces: [
        {
          id: "ws_demo",
          name: "Demo Workspace",
          slug: "demo-workspace",
          status: "active",
          defaultMode: "balanced",
        },
      ],
    });

    await withTemporaryAdminWorkspaceEnv(
      {
        ADMIN_WORKSPACE_ID: "ws_missing",
      },
      async () => {
        await assert.rejects(
          () => resolveDefaultAdminWorkspace(database),
          /Configured ADMIN_WORKSPACE_ID ws_missing did not resolve to an active workspace\./,
        );
      },
    );
  }

  {
    const database = createFakeAdminDatabase({
      workspaces: [
        {
          id: "ws_demo",
          name: "Demo Workspace",
          slug: "demo-workspace",
          status: "active",
          defaultMode: "balanced",
        },
        {
          id: "ws_pilot",
          name: "Pilot Workspace",
          slug: "pilot-workspace",
          status: "active",
          defaultMode: "balanced",
        },
      ],
    });

    await withTemporaryAdminWorkspaceEnv(
      {
        ADMIN_WORKSPACE_ID: "ws_pilot",
        ADMIN_SMOKE_WORKSPACE_ID: "ws_missing_smoke",
      },
      async () => {
        await assert.rejects(
          () => resolveDefaultAdminWorkspace(database),
          /Configured ADMIN_SMOKE_WORKSPACE_ID ws_missing_smoke did not resolve to an active workspace\./,
        );
      },
    );
  }

  {
    const database = createFakeAdminDatabase({
      workspaces: [
        {
          id: "ws_demo",
          name: "Demo Workspace",
          slug: "demo-workspace",
          status: "active",
          defaultMode: "balanced",
        },
        {
          id: "ws_pilot",
          name: "Pilot Workspace",
          slug: "pilot-workspace",
          status: "active",
          defaultMode: "budget",
        },
      ],
      projects: [
        {
          id: "proj_pilot",
          workspaceId: "ws_pilot",
          name: "Pilot Project",
          slug: "pilot-project",
          status: "active",
          defaultMode: "balanced",
        },
      ],
    });

    const workspaceContext = await withTemporaryAdminWorkspaceEnv({}, () =>
      resolveDefaultAdminWorkspace(database),
    );

    assert.ok(workspaceContext);
    assert.equal(workspaceContext?.workspace.id, "ws_pilot");
    assert.equal(workspaceContext?.project?.id, "proj_pilot");
  }

  {
    const database = createFakeAdminDatabase({
      workspaces: [
        {
          id: "ws_demo",
          name: "Demo Workspace",
          slug: "demo-workspace",
          status: "active",
          defaultMode: "balanced",
        },
        {
          id: "ws_archived",
          name: "Archived Workspace",
          slug: "archived-workspace",
          status: "inactive",
          defaultMode: "balanced",
        },
      ],
      projects: [
        {
          id: "proj_demo",
          workspaceId: "ws_demo",
          name: "Demo Project",
          slug: "demo-project",
          status: "active",
          defaultMode: "balanced",
        },
      ],
    });

    const workspaceContext = await withTemporaryAdminWorkspaceEnv({}, () =>
      resolveDefaultAdminWorkspace(database),
    );

    assert.ok(workspaceContext);
    assert.equal(workspaceContext?.workspace.id, "ws_demo");
    assert.equal(workspaceContext?.project?.id, "proj_demo");
  }

  {
    const database = createFakeAdminDatabase({
      workspaces: [
        {
          id: "ws_demo",
          name: "Demo Workspace",
          slug: "demo-workspace",
          status: "active",
          defaultMode: "balanced",
        },
        {
          id: "ws_pilot_a",
          name: "Pilot Workspace A",
          slug: "pilot-workspace-a",
          status: "active",
          defaultMode: "balanced",
        },
        {
          id: "ws_pilot_b",
          name: "Pilot Workspace B",
          slug: "pilot-workspace-b",
          status: "active",
          defaultMode: "balanced",
        },
      ],
    });

    await withTemporaryAdminWorkspaceEnv({}, async () => {
      await assert.rejects(
        () => resolveDefaultAdminWorkspace(database),
        /Configure ADMIN_WORKSPACE_ID to target the pilot workspace explicitly\./,
      );
    });
  }
});

test("provider credential state recognizes placeholder, legacy plaintext, encrypted, and malformed payloads", () => {
  const encryptedCredentials = encryptProviderCredentials(
    {
      apiKey: "test-provider-encrypted-demo-9999",
    },
    {
      PROVIDER_CREDENTIALS_SECRET: TEST_PROVIDER_CREDENTIALS_SECRET,
    },
  );

  assert.equal(
    getProviderCredentialState("demo-placeholder-openai-no-real-credentials"),
    "placeholder",
  );
  assert.equal(
    getProviderCredentialState('{"apiKey":"test-provider-legacy-demo-1234"}'),
    "stored",
  );
  assert.equal(getProviderCredentialState("sk-legacy-raw-5678"), "stored");
  assert.equal(getProviderCredentialState(encryptedCredentials), "stored");
  assert.equal(getProviderCredentialState('{"apiKey":123}'), "missing");
  assert.equal(
    getProviderCredentialState(
      '{"version":1,"algorithm":"aes-256-gcm","kdf":"scrypt","salt":"c2FsdA","iv":"aXY","ciphertext":"Y2lwaGVy","authTag":"dGFn"}',
    ),
    "missing",
  );
  assert.equal(getProviderCredentialState(""), "missing");
});

test("provider credential preview only returns safe metadata masks", () => {
  assert.equal(
    readMaskedProviderCredentialPreview({
      credentialMask: "****1234",
    }),
    "****1234",
  );
  assert.equal(
    readMaskedProviderCredentialPreview({
      credentialMask: "  ****mini  ",
    }),
    "****mini",
  );
  assert.equal(
    readMaskedProviderCredentialPreview({
      credentialMask: "***1234",
    }),
    null,
  );
  assert.equal(
    readMaskedProviderCredentialPreview({
      credentialMask: "****bad value",
    }),
    null,
  );
  assert.equal(readMaskedProviderCredentialPreview({}), null);
  assert.equal(readMaskedProviderCredentialPreview(null), null);
});

test("provider credential upsert stores encrypted credentials and updates masked provider summaries", async (t) => {
  const connection = await openIntegrationDatabase(t);

  if (!connection) {
    return;
  }

  const suffix = randomUUID().slice(0, 8);
  const workspaceId = `ws_admin_provider_${suffix}`;
  const projectId = `proj_admin_provider_${suffix}`;
  const providerAccountId = `provacc_admin_provider_${suffix}`;

  try {
    await connection.db.insert(workspaces).values({
      id: workspaceId,
      name: `Admin Provider ${suffix}`,
      slug: `admin-provider-${suffix}`,
      status: "active",
      defaultMode: "balanced",
    });
    await connection.db.insert(projects).values({
      id: projectId,
      workspaceId,
      name: `Admin Provider Project ${suffix}`,
      slug: `admin-provider-project-${suffix}`,
      status: "active",
      defaultMode: "balanced",
    });
    await connection.db.insert(providerAccounts).values({
      id: providerAccountId,
      workspaceId,
      provider: "openai",
      displayName: `OpenAI Admin ${suffix}`,
      status: "active",
      encryptedCredentials: "demo-placeholder-openai-no-real-credentials",
      testStatus: "demo-placeholder",
      lastTestedAt: new Date("2026-03-24T10:00:00.000Z"),
      metadata: {
        lastProviderOutcome: {
          source: "runtime",
          provider: "openai",
          modelId: "gpt-5-mini",
          requestStatus: "failed",
          errorType: "auth_error",
          errorCode: "provider_auth_failed",
          errorMessage: "legacy outcome should be cleared",
          latencyMs: 100,
          responseId: "resp_legacy",
          testedAt: "2026-03-24T10:00:00.000Z",
        },
        lastRuntimeOutcome: {
          requestStatus: "failed",
          errorType: "auth_error",
          errorCode: "provider_auth_failed",
          testedAt: "2026-03-24T10:00:00.000Z",
        },
      },
    });
    await connection.db.insert(auditEvents).values({
      id: `aud_admin_provider_test_${suffix}`,
      workspaceId,
      actorType: "system",
      eventType: "provider_account.connection_tested",
      entityType: "provider_account",
      entityId: providerAccountId,
      eventPayload: {
        message: "Provider connection test failed for openai.",
        provider: "openai",
        model: "gpt-5-mini",
        metadata: {
          request_status: "failed",
          error_code: "provider_auth_failed",
          error_message: "legacy explicit test should be treated as stale",
        },
      },
      createdAt: new Date("2026-03-24T11:00:00.000Z"),
    });

    await upsertProviderCredentials(
      {
        workspaceId,
        provider: "openai",
        apiKey: "sk-live-demo-1234",
      },
      connection.db,
    );

    const storedAccount = await connection.db.query.providerAccounts.findFirst({
      where: (table, { eq }) => eq(table.id, providerAccountId),
    });
    const providerSummaries = await listProviderStatusSummaries(
      workspaceId,
      connection.db,
    );
    const auditEvent = await connection.db.query.auditEvents.findFirst({
      where: (table, { and, eq }) =>
        and(
          eq(table.workspaceId, workspaceId),
          eq(table.eventType, "provider_account.credentials_updated"),
        ),
    });

    assert.ok(storedAccount);
    assert.equal(storedAccount?.testStatus, "configured");
    assert.equal(storedAccount?.lastTestedAt, null);
    assert.ok(
      parseProviderCredentialsEnvelope(
        storedAccount?.encryptedCredentials ?? "",
      ),
    );
    assert.equal(
      storedAccount?.encryptedCredentials === '{"apiKey":"sk-live-demo-1234"}',
      false,
    );
    assert.equal(
      storedAccount?.encryptedCredentials.includes("sk-live-demo-1234"),
      false,
    );
    assert.equal(
      (storedAccount?.metadata as { credentialMask?: string })?.credentialMask,
      "****1234",
    );
    assert.equal(
      Object.hasOwn(
        (storedAccount?.metadata as Record<string, unknown>) ?? {},
        "lastProviderOutcome",
      ),
      false,
    );
    assert.equal(
      Object.hasOwn(
        (storedAccount?.metadata as Record<string, unknown>) ?? {},
        "lastRuntimeOutcome",
      ),
      false,
    );

    const openAiSummary = providerSummaries.find(
      (summary) => summary.provider === "openai",
    );

    assert.ok(openAiSummary);
    assert.equal(openAiSummary?.credentialState, "stored");
    assert.equal(openAiSummary?.readiness, "configured");
    assert.equal(openAiSummary?.credentialPreview, "****1234");
    assert.equal(openAiSummary?.lastConnectionTest, null);
    assert.equal(openAiSummary?.lastOutcome, null);
    assert.equal(
      Object.hasOwn(
        (openAiSummary as unknown as Record<string, unknown>) ?? {},
        "encryptedCredentials",
      ),
      false,
    );
    assert.equal(
      Object.hasOwn(
        (openAiSummary as unknown as Record<string, unknown>) ?? {},
        "apiKey",
      ),
      false,
    );
    assert.equal(
      JSON.stringify(openAiSummary).includes("sk-live-demo-1234"),
      false,
    );
    assert.equal(
      JSON.stringify(openAiSummary).includes('"encryptedCredentials"'),
      false,
    );
    assert.equal(JSON.stringify(openAiSummary).includes('"apiKey"'), false);
    assert.ok(auditEvent);
    assert.deepEqual(auditEvent?.eventPayload, {
      message: "Updated openai provider credentials from admin.",
      provider: "openai",
      credential_mask: "****1234",
    });
  } finally {
    await connection.db
      .delete(auditEvents)
      .where(eq(auditEvents.workspaceId, workspaceId));
    await connection.db
      .delete(providerAccounts)
      .where(eq(providerAccounts.workspaceId, workspaceId));
    await connection.db
      .delete(projects)
      .where(eq(projects.workspaceId, workspaceId));
    await connection.db
      .delete(workspaces)
      .where(eq(workspaces.id, workspaceId));
  }
});

test("provider status summaries expose the latest explicit connection test after the latest credential save", async (t) => {
  const connection = await openIntegrationDatabase(t);

  if (!connection) {
    return;
  }

  const suffix = randomUUID().slice(0, 8);
  const workspaceId = `ws_admin_provider_test_${suffix}`;
  const projectId = `proj_admin_provider_test_${suffix}`;

  try {
    await connection.db.insert(workspaces).values({
      id: workspaceId,
      name: `Admin Provider Test ${suffix}`,
      slug: `admin-provider-test-${suffix}`,
      status: "active",
      defaultMode: "balanced",
    });
    await connection.db.insert(projects).values({
      id: projectId,
      workspaceId,
      name: `Admin Provider Test Project ${suffix}`,
      slug: `admin-provider-test-project-${suffix}`,
      status: "active",
      defaultMode: "balanced",
    });

    await upsertProviderCredentials(
      {
        workspaceId,
        provider: "anthropic",
        apiKey: "test-provider-live-anthropic-5678",
      },
      connection.db,
    );

    const storedAccount = await connection.db.query.providerAccounts.findFirst({
      where: (table, { and, eq }) =>
        and(
          eq(table.workspaceId, workspaceId),
          eq(table.provider, "anthropic"),
        ),
    });
    assert.ok(storedAccount);

    const credentialUpdatedAt = new Date(
      String(
        (storedAccount.metadata as { credentialUpdatedAt?: string } | null)
          ?.credentialUpdatedAt ?? storedAccount.updatedAt.toISOString(),
      ),
    );
    const connectionTestCreatedAt = new Date(
      credentialUpdatedAt.valueOf() + 60_000,
    );

    await connection.db.insert(auditEvents).values({
      id: `aud_admin_provider_current_test_${suffix}`,
      workspaceId,
      actorType: "system",
      eventType: "provider_account.connection_tested",
      entityType: "provider_account",
      entityId: storedAccount.id,
      eventPayload: {
        message: "Provider connection test failed for anthropic.",
        provider: "anthropic",
        model: "claude-3-5-haiku-20241022",
        metadata: {
          request_status: "failed",
          error_code: "provider_auth_failed",
          error_message: "Anthropic rejected the configured API key.",
        },
      },
      createdAt: connectionTestCreatedAt,
    });

    const providerSummaries = await listProviderStatusSummaries(
      workspaceId,
      connection.db,
    );
    const anthropicSummary = providerSummaries.find(
      (summary) => summary.provider === "anthropic",
    );

    assert.ok(anthropicSummary);
    assert.deepEqual(anthropicSummary?.lastConnectionTest, {
      testedAt: connectionTestCreatedAt.toISOString(),
      requestStatus: "failed",
      modelId: "claude-3-5-haiku-20241022",
      errorCode: "provider_auth_failed",
      errorMessage: "Anthropic rejected the configured API key.",
    });
  } finally {
    await connection.db
      .delete(auditEvents)
      .where(eq(auditEvents.workspaceId, workspaceId));
    await connection.db
      .delete(providerAccounts)
      .where(eq(providerAccounts.workspaceId, workspaceId));
    await connection.db
      .delete(projects)
      .where(eq(projects.workspaceId, workspaceId));
    await connection.db
      .delete(workspaces)
      .where(eq(workspaces.id, workspaceId));
  }
});

test("admin read models sanitize request payloads and expose key and usage summaries", async (t) => {
  const connection = await openIntegrationDatabase(t);

  if (!connection) {
    return;
  }

  const suffix = randomUUID().slice(0, 8);
  const workspaceId = `ws_admin_read_${suffix}`;
  const projectId = `proj_admin_read_${suffix}`;
  const apiKeyId = `gak_admin_read_${suffix}`;
  const providerAccountId = `provacc_admin_read_${suffix}`;
  const requestId = `req_admin_read_${suffix}`;
  const attemptId = `att_admin_read_${suffix}`;

  try {
    await connection.db.insert(workspaces).values({
      id: workspaceId,
      name: `Admin Read ${suffix}`,
      slug: `admin-read-${suffix}`,
      status: "active",
      defaultMode: "balanced",
    });
    await connection.db.insert(projects).values({
      id: projectId,
      workspaceId,
      name: `Admin Read Project ${suffix}`,
      slug: `admin-read-project-${suffix}`,
      status: "active",
      defaultMode: "balanced",
    });
    await connection.db.insert(gatewayApiKeys).values({
      id: apiKeyId,
      workspaceId,
      projectId,
      name: `Admin Read Key ${suffix}`,
      keyPrefix: `nl_${suffix}`,
      keyHash: `hash_${suffix}`,
      status: "active",
    });
    await connection.db.insert(providerAccounts).values({
      id: providerAccountId,
      workspaceId,
      provider: "openai",
      displayName: `OpenAI Read ${suffix}`,
      status: "active",
      encryptedCredentials: '{"apiKey":"sk-read-demo-1234"}',
      testStatus: "ready",
    });
    await connection.db.insert(requests).values({
      id: requestId,
      workspaceId,
      projectId,
      apiKeyId,
      source: "api",
      mode: "balanced",
      taskType: "general",
      status: "succeeded",
      normalizedRequestJson: {
        stream: false,
        messages: [
          {
            role: "user",
            content: "Do not show this in the admin UI.",
          },
        ],
        metadata: {
          source: "integration-test",
        },
      },
      requestMetadata: {
        source: "integration-test",
      },
      startedAt: new Date("2026-03-24T10:00:00.000Z"),
      completedAt: new Date("2026-03-24T10:00:05.000Z"),
    });
    await connection.db.insert(requestAttempts).values({
      id: attemptId,
      requestId,
      workspaceId,
      projectId,
      providerAccountId,
      provider: "openai",
      modelId: "gpt-5-mini",
      attemptNumber: 1,
      status: "succeeded",
      startedAt: new Date("2026-03-24T10:00:01.000Z"),
      completedAt: new Date("2026-03-24T10:00:04.000Z"),
      latencyMs: 321,
      providerRequestId: `provider_${suffix}`,
    });
    await connection.db.insert(usageRecords).values({
      id: `usage_admin_read_${suffix}`,
      workspaceId,
      projectId,
      requestId,
      attemptId,
      provider: "openai",
      modelId: "gpt-5-mini",
      usageSource: "estimated",
      inputTokens: 12,
      outputTokens: 8,
      totalTokens: 20,
      costTotal: "0.12340000",
      pricingVersion: "catalog_cost_tier_v1",
      recordedAt: new Date("2026-03-24T10:00:04.000Z"),
    });
    await connection.db.insert(auditEvents).values([
      {
        id: `audit_admin_read_routing_${suffix}`,
        workspaceId,
        projectId,
        actorType: "api_key",
        actorApiKeyId: apiKeyId,
        eventType: "chat.routing.decision",
        entityType: "request",
        entityId: requestId,
        eventPayload: {
          message:
            "Selected the best balanced candidate from the local router.",
          routing_decision: {
            outcome: "selected",
            selectionReasonCode: "best_score_for_mode",
            selectionReasonText:
              "Selected the best balanced candidate from the local router.",
            selected: {
              provider: "openai",
              model: "gpt-5-mini",
            },
          },
        },
      },
      {
        id: `audit_admin_read_completed_${suffix}`,
        workspaceId,
        projectId,
        actorType: "api_key",
        actorApiKeyId: apiKeyId,
        eventType: "chat.completions.completed",
        entityType: "request",
        entityId: requestId,
        eventPayload: {
          message: "Chat completion executed successfully.",
          metadata: {
            request_status: "succeeded",
            provider: "openai",
            model: "gpt-5-mini",
            cost_total_usd: 0.1234,
          },
        },
      },
    ]);

    await touchGatewayApiKeyLastUsedAt(
      apiKeyId,
      {
        now: new Date("2026-03-24T10:00:06.000Z"),
      },
      connection.db,
    );

    const requestSummaries = await listRecentWorkspaceRequests(
      {
        workspaceId,
        limit: 5,
      },
      connection.db,
    );
    const apiKeySummaries = await listActiveGatewayApiKeySummaries(
      workspaceId,
      connection.db,
    );
    const auditSummaries = await listRecentWorkspaceAuditEvents(
      {
        workspaceId,
        limit: 5,
      },
      connection.db,
    );
    const overviewStats = await getWorkspaceOverviewStats(
      {
        workspaceId,
        start: new Date("2026-03-01T00:00:00.000Z"),
        end: new Date("2026-04-01T00:00:00.000Z"),
      },
      connection.db,
    );

    assert.equal(requestSummaries.length, 1);
    assert.equal(requestSummaries[0]?.requestEnvelope.messageCount, 1);
    assert.deepEqual(requestSummaries[0]?.requestEnvelope.messageRoles, [
      "user",
    ]);
    assert.equal(requestSummaries[0]?.requestEnvelope.promptRedacted, true);
    assert.equal(
      requestSummaries[0]?.routing.selectionReasonCode,
      "best_score_for_mode",
    );
    assert.equal(requestSummaries[0]?.usage?.costTotalUsd, 0.1234);

    assert.equal(apiKeySummaries[0]?.keyPrefix, `nl_${suffix}`);
    assert.equal(apiKeySummaries[0]?.lastUsedAt, "2026-03-24T10:00:06.000Z");

    assert.ok(
      auditSummaries.some(
        (auditSummary) =>
          auditSummary.eventType === "chat.completions.completed",
      ),
    );
    assert.equal(overviewStats.requestCount, 1);
    assert.equal(overviewStats.succeededCount, 1);
    assert.equal(overviewStats.totalTokens, 20);
    assert.equal(overviewStats.totalCostUsd, 0.1234);
  } finally {
    await connection.db
      .delete(usageRecords)
      .where(eq(usageRecords.workspaceId, workspaceId));
    await connection.db
      .delete(requestAttempts)
      .where(eq(requestAttempts.workspaceId, workspaceId));
    await connection.db
      .delete(auditEvents)
      .where(eq(auditEvents.workspaceId, workspaceId));
    await connection.db
      .delete(requests)
      .where(eq(requests.workspaceId, workspaceId));
    await connection.db
      .delete(gatewayApiKeys)
      .where(eq(gatewayApiKeys.workspaceId, workspaceId));
    await connection.db
      .delete(providerAccounts)
      .where(eq(providerAccounts.workspaceId, workspaceId));
    await connection.db
      .delete(projects)
      .where(eq(projects.workspaceId, workspaceId));
    await connection.db
      .delete(workspaces)
      .where(eq(workspaces.id, workspaceId));
  }
});
