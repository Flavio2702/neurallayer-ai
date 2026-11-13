import assert from "node:assert/strict";
import { type TestContext, test } from "node:test";

import { loadDatabaseConfig } from "@neuralayer/config";
import {
  createDbConnection,
  encryptProviderCredentials,
  eq,
  gatewayApiKeys,
  hashGatewayApiKey,
  projects,
  providerAccounts,
  workspaces,
} from "@neuralayer/db";

import { createDatabaseGatewayAuthService } from "./context";

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

test("database auth service updates last-used timestamps and only exposes providers with usable credentials", async (t) => {
  const connection = await openIntegrationDatabase(t);

  if (!connection) {
    return;
  }

  const workspaceId = "ws_auth_context_test";
  const projectId = "proj_auth_context_test";
  const apiKeyId = "gak_auth_context_test";
  const rawApiKey = "nl_auth_context_test_key";
  const authService = createDatabaseGatewayAuthService();

  try {
    await connection.db.insert(workspaces).values({
      id: workspaceId,
      name: "Auth Context Test",
      slug: "auth-context-test",
      status: "active",
      defaultMode: "balanced",
    });
    await connection.db.insert(projects).values({
      id: projectId,
      workspaceId,
      name: "Auth Context Project",
      slug: "auth-context-project",
      status: "active",
      defaultMode: "balanced",
    });
    await connection.db.insert(gatewayApiKeys).values({
      id: apiKeyId,
      workspaceId,
      projectId,
      name: "Auth Context Key",
      keyPrefix: "nl_auth_cont",
      keyHash: hashGatewayApiKey(rawApiKey),
      status: "active",
    });
    await connection.db.insert(providerAccounts).values([
      {
        id: "provacc_auth_context_openai",
        workspaceId,
        provider: "openai",
        displayName: "OpenAI Auth Context",
        status: "active",
        encryptedCredentials: encryptProviderCredentials(
          {
            apiKey: "test-provider-auth-context-openai",
          },
          {
            PROVIDER_CREDENTIALS_SECRET:
              "provider-credentials-auth-context-456",
          },
        ),
        testStatus: "configured",
      },
      {
        id: "provacc_auth_context_anthropic",
        workspaceId,
        provider: "anthropic",
        displayName: "Anthropic Auth Context",
        status: "active",
        encryptedCredentials: "demo-placeholder-anthropic-no-real-credentials",
        testStatus: "demo-placeholder",
      },
    ]);

    const authContext = await authService.authenticateApiKey(rawApiKey, {
      now: new Date("2026-03-24T12:00:00.000Z"),
    });
    const meContext = authContext
      ? await authService.loadMeContext(authContext)
      : null;
    const storedApiKey = await connection.db.query.gatewayApiKeys.findFirst({
      where: (table, { eq }) => eq(table.id, apiKeyId),
    });

    assert.deepEqual(authContext, {
      workspaceId,
      apiKeyId,
      defaultProjectId: projectId,
    });
    assert.deepEqual(meContext?.providersConfigured, ["openai"]);
    assert.equal(
      storedApiKey?.lastUsedAt?.toISOString(),
      "2026-03-24T12:00:00.000Z",
    );
  } finally {
    await connection.db
      .delete(providerAccounts)
      .where(eq(providerAccounts.workspaceId, workspaceId));
    await connection.db
      .delete(gatewayApiKeys)
      .where(eq(gatewayApiKeys.workspaceId, workspaceId));
    await connection.db
      .delete(projects)
      .where(eq(projects.workspaceId, workspaceId));
    await connection.db
      .delete(workspaces)
      .where(eq(workspaces.id, workspaceId));
  }
});
