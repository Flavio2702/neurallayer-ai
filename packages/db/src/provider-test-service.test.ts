import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { type TestContext, test } from "node:test";

import { loadDatabaseConfig } from "@neuralayer/config";
import { eq } from "drizzle-orm";

import { createDbConnection } from "./client";
import { encryptProviderCredentials } from "./provider-credentials-crypto";
import { testWorkspaceProviderConnection } from "./provider-test-service";
import {
  auditEvents,
  modelCatalog,
  providerAccounts,
  requestAttempts,
  requests,
  usageRecords,
  workspaces,
} from "./schema";

const TEST_PROVIDER_CREDENTIALS_SECRET = "provider-credentials-secret-123";
const DIFFERENT_PROVIDER_CREDENTIALS_SECRET = "provider-credentials-secret-456";

process.env.PROVIDER_CREDENTIALS_SECRET ??= TEST_PROVIDER_CREDENTIALS_SECRET;

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

test("testWorkspaceProviderConnection runs the injected provider test, persists posture, and does not create request rows", async (t) => {
  const connection = await openIntegrationDatabase(t);

  if (!connection) {
    return;
  }

  const suffix = randomUUID().slice(0, 8);
  const workspaceId = `ws_provider_test_${suffix}`;
  const providerAccountId = `provacc_provider_test_${suffix}`;
  const modelId = `aaa-provider-test-openai-${suffix}`;
  let receivedModel: string | null = null;

  try {
    await connection.db.insert(workspaces).values({
      id: workspaceId,
      name: `Provider Test ${suffix}`,
      slug: `provider-test-${suffix}`,
      status: "active",
      defaultMode: "balanced",
    });
    await connection.db.insert(modelCatalog).values({
      id: `mdl_provider_test_openai_${suffix}`,
      provider: "openai",
      modelId,
      label: `Provider Test OpenAI ${suffix}`,
      status: "active",
      isActive: true,
      supportsChat: true,
      supportsStreaming: false,
      capabilityClasses: ["general"],
      costTier: "low",
      latencyTier: "fast",
    });
    await connection.db.insert(providerAccounts).values({
      id: providerAccountId,
      workspaceId,
      provider: "openai",
      displayName: `Provider Test OpenAI ${suffix}`,
      status: "active",
      encryptedCredentials: encryptProviderCredentials(
        {
          apiKey: `sk-provider-test-${suffix}`,
        },
        {
          PROVIDER_CREDENTIALS_SECRET: TEST_PROVIDER_CREDENTIALS_SECRET,
        },
      ),
      testStatus: "configured",
    });

    const result = await testWorkspaceProviderConnection(
      {
        workspaceId,
        provider: "openai",
      },
      {
        now: new Date("2026-03-26T12:00:00.000Z"),
        runConnectionTest: async (input) => {
          receivedModel = input.model;

          return {
            provider: input.provider,
            model: input.model,
            requestStatus: "succeeded",
            outputText: "ok",
            latencyMs: 222,
            responseId: "resp_provider_test_success",
          };
        },
      },
      connection.db,
    );

    const storedAccount = await connection.db.query.providerAccounts.findFirst({
      where: (table, { eq: equals }) => equals(table.id, providerAccountId),
    });
    const connectionAudit = await connection.db.query.auditEvents.findFirst({
      where: (table, { and, eq: equals }) =>
        and(
          equals(table.workspaceId, workspaceId),
          equals(table.eventType, "provider_account.connection_tested"),
        ),
    });
    const requestRows = await connection.db
      .select({ count: requests.id })
      .from(requests)
      .where(eq(requests.workspaceId, workspaceId));
    const attemptRows = await connection.db
      .select({ count: requestAttempts.id })
      .from(requestAttempts)
      .where(eq(requestAttempts.workspaceId, workspaceId));
    const usageRows = await connection.db
      .select({ count: usageRecords.id })
      .from(usageRecords)
      .where(eq(usageRecords.workspaceId, workspaceId));

    assert.equal(receivedModel, modelId);
    assert.equal(result.requestStatus, "succeeded");
    assert.equal(result.modelId, modelId);
    assert.equal(result.providerAccountId, providerAccountId);
    assert.equal(result.posture?.testStatus, "ready");
    assert.equal(storedAccount?.testStatus, "ready");
    assert.equal(
      storedAccount?.lastTestedAt?.toISOString(),
      "2026-03-26T12:00:00.000Z",
    );
    assert.deepEqual(
      (storedAccount?.metadata as { lastProviderOutcome?: unknown })
        ?.lastProviderOutcome,
      {
        source: "provider_test",
        provider: "openai",
        modelId,
        requestStatus: "succeeded",
        errorType: null,
        errorCode: null,
        errorMessage: null,
        latencyMs: 222,
        responseId: "resp_provider_test_success",
        testedAt: "2026-03-26T12:00:00.000Z",
      },
    );
    assert.ok(connectionAudit);
    assert.deepEqual(requestRows, []);
    assert.deepEqual(attemptRows, []);
    assert.deepEqual(usageRows, []);
  } finally {
    await connection.db
      .delete(auditEvents)
      .where(eq(auditEvents.workspaceId, workspaceId));
    await connection.db
      .delete(providerAccounts)
      .where(eq(providerAccounts.workspaceId, workspaceId));
    await connection.db
      .delete(modelCatalog)
      .where(eq(modelCatalog.id, `mdl_provider_test_openai_${suffix}`));
    await connection.db
      .delete(workspaces)
      .where(eq(workspaces.id, workspaceId));
  }
});

test("testWorkspaceProviderConnection persists a safe invalid configuration failure when credentials cannot be decrypted", async (t) => {
  const connection = await openIntegrationDatabase(t);

  if (!connection) {
    return;
  }

  const suffix = randomUUID().slice(0, 8);
  const workspaceId = `ws_provider_test_invalid_${suffix}`;
  const providerAccountId = `provacc_provider_test_invalid_${suffix}`;
  const modelId = `aaa-provider-test-anthropic-${suffix}`;
  let runCallCount = 0;

  try {
    await connection.db.insert(workspaces).values({
      id: workspaceId,
      name: `Provider Test Invalid ${suffix}`,
      slug: `provider-test-invalid-${suffix}`,
      status: "active",
      defaultMode: "balanced",
    });
    await connection.db.insert(modelCatalog).values({
      id: `mdl_provider_test_anthropic_${suffix}`,
      provider: "anthropic",
      modelId,
      label: `Provider Test Anthropic ${suffix}`,
      status: "active",
      isActive: true,
      supportsChat: true,
      supportsStreaming: false,
      capabilityClasses: ["general"],
      costTier: "low",
      latencyTier: "fast",
    });
    await connection.db.insert(providerAccounts).values({
      id: providerAccountId,
      workspaceId,
      provider: "anthropic",
      displayName: `Provider Test Anthropic ${suffix}`,
      status: "active",
      encryptedCredentials: encryptProviderCredentials(
        {
          apiKey: `test-provider-provider-test-invalid-${suffix}`,
        },
        {
          PROVIDER_CREDENTIALS_SECRET: DIFFERENT_PROVIDER_CREDENTIALS_SECRET,
        },
      ),
      testStatus: "configured",
    });

    const result = await testWorkspaceProviderConnection(
      {
        workspaceId,
        provider: "anthropic",
      },
      {
        now: new Date("2026-03-26T13:00:00.000Z"),
        runConnectionTest: async () => {
          runCallCount += 1;

          throw new Error("runner should not be called");
        },
      },
      connection.db,
    );

    const storedAccount = await connection.db.query.providerAccounts.findFirst({
      where: (table, { eq: equals }) => equals(table.id, providerAccountId),
    });
    const connectionAudit = await connection.db.query.auditEvents.findFirst({
      where: (table, { and, eq: equals }) =>
        and(
          equals(table.workspaceId, workspaceId),
          equals(table.eventType, "provider_account.connection_tested"),
        ),
    });

    assert.equal(runCallCount, 0);
    assert.equal(result.requestStatus, "failed");
    assert.equal(result.error?.type, "auth_error");
    assert.equal(result.error?.code, "invalid_provider_configuration");
    assert.equal(
      result.error?.message,
      "Configured provider credentials are invalid or unreadable for this workspace.",
    );
    assert.equal(storedAccount?.status, "error");
    assert.equal(storedAccount?.testStatus, "configuration_error");
    assert.deepEqual(
      (storedAccount?.metadata as { lastProviderOutcome?: unknown })
        ?.lastProviderOutcome,
      {
        source: "provider_test",
        provider: "anthropic",
        modelId,
        requestStatus: "failed",
        errorType: "auth_error",
        errorCode: "invalid_provider_configuration",
        errorMessage:
          "Configured provider credentials are invalid or unreadable for this workspace.",
        latencyMs: null,
        responseId: null,
        testedAt: "2026-03-26T13:00:00.000Z",
      },
    );
    assert.ok(connectionAudit);
  } finally {
    await connection.db
      .delete(auditEvents)
      .where(eq(auditEvents.workspaceId, workspaceId));
    await connection.db
      .delete(providerAccounts)
      .where(eq(providerAccounts.workspaceId, workspaceId));
    await connection.db
      .delete(modelCatalog)
      .where(eq(modelCatalog.id, `mdl_provider_test_anthropic_${suffix}`));
    await connection.db
      .delete(workspaces)
      .where(eq(workspaces.id, workspaceId));
  }
});
