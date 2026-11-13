import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { type TestContext, test } from "node:test";

import { loadDatabaseConfig } from "@neuralayer/config";
import { eq } from "drizzle-orm";

import { createDbConnection } from "./client";
import {
  ProviderCredentialsResolutionError,
  resolveProviderAccountExecutionConfig,
} from "./provider-account-credentials";
import { encryptProviderCredentials } from "./provider-credentials-crypto";
import { providerAccounts, workspaces } from "./schema";

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

test("resolveProviderAccountExecutionConfig decrypts encrypted credentials and skips unusable earlier accounts", async (t) => {
  const connection = await openIntegrationDatabase(t);

  if (!connection) {
    return;
  }

  const suffix = randomUUID().slice(0, 8);
  const workspaceId = `ws_provider_runtime_${suffix}`;
  const encryptedAccountId = `provacc_provider_runtime_encrypted_${suffix}`;

  try {
    await connection.db.insert(workspaces).values({
      id: workspaceId,
      name: `Provider Runtime ${suffix}`,
      slug: `provider-runtime-${suffix}`,
      status: "active",
      defaultMode: "balanced",
    });
    await connection.db.insert(providerAccounts).values([
      {
        id: `provacc_provider_runtime_placeholder_${suffix}`,
        workspaceId,
        provider: "openai",
        displayName: `A Placeholder ${suffix}`,
        status: "active",
        encryptedCredentials: "demo-placeholder-openai-no-real-credentials",
        testStatus: "configured",
      },
      {
        id: `provacc_provider_runtime_invalid_${suffix}`,
        workspaceId,
        provider: "openai",
        displayName: `B Invalid ${suffix}`,
        status: "active",
        encryptedCredentials: JSON.stringify({
          version: 1,
          algorithm: "aes-256-gcm",
          kdf: "scrypt",
          salt: "bad",
          iv: "bad",
          ciphertext: "bad",
          authTag: "bad",
        }),
        testStatus: "configured",
      },
      {
        id: encryptedAccountId,
        workspaceId,
        provider: "openai",
        displayName: `C Encrypted ${suffix}`,
        status: "active",
        encryptedCredentials: encryptProviderCredentials(
          {
            apiKey: `test-provider-runtime-encrypted-${suffix}`,
          },
          {
            PROVIDER_CREDENTIALS_SECRET: TEST_PROVIDER_CREDENTIALS_SECRET,
          },
        ),
        testStatus: "configured",
      },
    ]);

    const resolvedConfig = await resolveProviderAccountExecutionConfig(
      {
        workspaceId,
        provider: "openai",
      },
      connection.db,
    );

    assert.deepEqual(resolvedConfig, {
      providerAccountId: encryptedAccountId,
      displayName: `C Encrypted ${suffix}`,
      config: {
        apiKey: `test-provider-runtime-encrypted-${suffix}`,
      },
    });
  } finally {
    await connection.db
      .delete(providerAccounts)
      .where(eq(providerAccounts.workspaceId, workspaceId));
    await connection.db
      .delete(workspaces)
      .where(eq(workspaces.id, workspaceId));
  }
});

test("resolveProviderAccountExecutionConfig preserves legacy plaintext credentials for the runtime path", async (t) => {
  const connection = await openIntegrationDatabase(t);

  if (!connection) {
    return;
  }

  const suffix = randomUUID().slice(0, 8);
  const workspaceId = `ws_provider_legacy_${suffix}`;
  const providerAccountId = `provacc_provider_legacy_${suffix}`;

  try {
    await connection.db.insert(workspaces).values({
      id: workspaceId,
      name: `Provider Legacy ${suffix}`,
      slug: `provider-legacy-${suffix}`,
      status: "active",
      defaultMode: "balanced",
    });
    await connection.db.insert(providerAccounts).values({
      id: providerAccountId,
      workspaceId,
      provider: "anthropic",
      displayName: `Legacy Anthropic ${suffix}`,
      status: "active",
      encryptedCredentials: '{"apiKey":"test-provider-legacy-runtime-1234"}',
      testStatus: "configured",
    });

    const resolvedConfig = await resolveProviderAccountExecutionConfig(
      {
        workspaceId,
        provider: "anthropic",
      },
      connection.db,
    );

    assert.deepEqual(resolvedConfig, {
      providerAccountId,
      displayName: `Legacy Anthropic ${suffix}`,
      config: {
        apiKey: "test-provider-legacy-runtime-1234",
      },
    });
  } finally {
    await connection.db
      .delete(providerAccounts)
      .where(eq(providerAccounts.workspaceId, workspaceId));
    await connection.db
      .delete(workspaces)
      .where(eq(workspaces.id, workspaceId));
  }
});

test("resolveProviderAccountExecutionConfig throws a safe invalid configuration error when encrypted credentials cannot be decrypted", async (t) => {
  const connection = await openIntegrationDatabase(t);

  if (!connection) {
    return;
  }

  const suffix = randomUUID().slice(0, 8);
  const workspaceId = `ws_provider_invalid_${suffix}`;
  const providerAccountId = `provacc_provider_invalid_${suffix}`;

  try {
    await connection.db.insert(workspaces).values({
      id: workspaceId,
      name: `Provider Invalid ${suffix}`,
      slug: `provider-invalid-${suffix}`,
      status: "active",
      defaultMode: "balanced",
    });
    await connection.db.insert(providerAccounts).values({
      id: providerAccountId,
      workspaceId,
      provider: "openai",
      displayName: `Invalid OpenAI ${suffix}`,
      status: "active",
      encryptedCredentials: encryptProviderCredentials(
        {
          apiKey: `test-provider-runtime-invalid-${suffix}`,
        },
        {
          PROVIDER_CREDENTIALS_SECRET: DIFFERENT_PROVIDER_CREDENTIALS_SECRET,
        },
      ),
      testStatus: "configured",
    });

    await assert.rejects(
      () =>
        resolveProviderAccountExecutionConfig(
          {
            workspaceId,
            provider: "openai",
          },
          connection.db,
        ),
      (error: unknown) => {
        assert.equal(error instanceof ProviderCredentialsResolutionError, true);
        assert.equal(
          (error as ProviderCredentialsResolutionError).code,
          "invalid_provider_configuration",
        );
        assert.equal(
          (error as ProviderCredentialsResolutionError).providerAccountId,
          providerAccountId,
        );
        assert.equal(
          (error as ProviderCredentialsResolutionError).message,
          "Configured provider credentials are invalid or unreadable for this workspace.",
        );

        return true;
      },
    );
  } finally {
    await connection.db
      .delete(providerAccounts)
      .where(eq(providerAccounts.workspaceId, workspaceId));
    await connection.db
      .delete(workspaces)
      .where(eq(workspaces.id, workspaceId));
  }
});

test("resolveProviderAccountExecutionConfig preserves the safe invalid configuration failure when the decrypt secret is unavailable", async () => {
  const providerAccountId = "provacc_provider_missing_secret";
  const encryptedCredentials = encryptProviderCredentials(
    {
      apiKey: "test-provider-runtime-missing-secret",
    },
    {
      PROVIDER_CREDENTIALS_SECRET: TEST_PROVIDER_CREDENTIALS_SECRET,
    },
  );
  const originalSecret = process.env.PROVIDER_CREDENTIALS_SECRET;

  delete process.env.PROVIDER_CREDENTIALS_SECRET;

  try {
    await assert.rejects(
      () =>
        resolveProviderAccountExecutionConfig(
          {
            workspaceId: "ws_provider_missing_secret",
            provider: "openai",
          },
          {
            query: {
              providerAccounts: {
                findMany: async () => [
                  {
                    id: providerAccountId,
                    displayName: "Missing Secret Account",
                    encryptedCredentials,
                  },
                ],
              },
            },
          } as never,
        ),
      (error: unknown) => {
        assert.equal(error instanceof ProviderCredentialsResolutionError, true);
        assert.equal(
          (error as ProviderCredentialsResolutionError).code,
          "invalid_provider_configuration",
        );
        assert.equal(
          (error as ProviderCredentialsResolutionError).providerAccountId,
          providerAccountId,
        );
        assert.equal(
          (error as ProviderCredentialsResolutionError).message,
          "Configured provider credentials are invalid or unreadable for this workspace.",
        );

        return true;
      },
    );
  } finally {
    if (typeof originalSecret === "string") {
      process.env.PROVIDER_CREDENTIALS_SECRET = originalSecret;
    } else {
      delete process.env.PROVIDER_CREDENTIALS_SECRET;
    }
  }
});
