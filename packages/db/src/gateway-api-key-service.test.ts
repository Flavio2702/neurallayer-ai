import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { type TestContext, test } from "node:test";

import { loadDatabaseConfig } from "@neuralayer/config";
import { eq } from "drizzle-orm";

import { createDbConnection, type Database } from "./client";
import {
  createProjectGatewayApiKey,
  GatewayApiKeyLifecycleError,
  generateRawGatewayApiKey,
  getGatewayApiKeyPrefix,
  hashGatewayApiKey,
  listProjectGatewayApiKeys,
  revokeProjectGatewayApiKey,
  touchGatewayApiKeyLastUsedAt,
} from "./gateway-api-key-service";
import { auditEvents, gatewayApiKeys, projects, workspaces } from "./schema";

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

async function insertWorkspace(database: Database, suffix: string) {
  const workspaceId = `ws_gateway_api_key_${suffix}`;

  await database.insert(workspaces).values({
    id: workspaceId,
    name: `Gateway API Key ${suffix}`,
    slug: `gateway-api-key-${suffix}`,
    status: "active",
    defaultMode: "balanced",
  });

  return workspaceId;
}

async function insertProject(
  database: Database,
  input: {
    workspaceId: string;
    projectId: string;
    status?: "active" | "inactive";
  },
) {
  await database.insert(projects).values({
    id: input.projectId,
    workspaceId: input.workspaceId,
    name: `Project ${input.projectId}`,
    slug: `project-${input.projectId}`,
    status: input.status ?? "active",
    defaultMode: "balanced",
  });
}

async function insertGatewayApiKey(
  database: Database,
  input: {
    workspaceId: string;
    projectId: string | null;
    name: string;
    rawKey: string;
    status?: "active" | "revoked" | "expired";
    createdAt?: Date;
  },
) {
  const now = input.createdAt ?? new Date();
  const apiKeyId = `gak_${randomUUID().slice(0, 8)}`;

  await database.insert(gatewayApiKeys).values({
    id: apiKeyId,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    name: input.name,
    keyPrefix: getGatewayApiKeyPrefix(input.rawKey),
    keyHash: hashGatewayApiKey(input.rawKey),
    status: input.status ?? "active",
    createdAt: now,
    updatedAt: now,
  });

  return apiKeyId;
}

async function cleanupWorkspace(database: Database, workspaceId: string) {
  await database
    .delete(auditEvents)
    .where(eq(auditEvents.workspaceId, workspaceId));
  await database
    .delete(gatewayApiKeys)
    .where(eq(gatewayApiKeys.workspaceId, workspaceId));
  await database.delete(projects).where(eq(projects.workspaceId, workspaceId));
  await database.delete(workspaces).where(eq(workspaces.id, workspaceId));
}

test("gateway API key helpers produce a prefixed raw key plus stable hash and prefix", () => {
  const rawKey = generateRawGatewayApiKey();

  assert.match(rawKey, /^nl_[A-Za-z0-9_-]+$/);
  assert.equal(getGatewayApiKeyPrefix(rawKey), rawKey.slice(0, 12));
  assert.equal(hashGatewayApiKey(rawKey), hashGatewayApiKey(rawKey));
  assert.equal(hashGatewayApiKey(rawKey).length, 64);
});

test("createProjectGatewayApiKey stores only prefix and hash, returns raw once, and audits creation", async (t) => {
  const connection = await openIntegrationDatabase(t);

  if (!connection) {
    return;
  }

  const suffix = randomUUID().slice(0, 8);
  const workspaceId = await insertWorkspace(connection.db, suffix);
  const projectId = `proj_gateway_api_key_${suffix}`;

  try {
    await insertProject(connection.db, {
      workspaceId,
      projectId,
    });

    const createdApiKey = await createProjectGatewayApiKey(
      {
        workspaceId,
        projectId,
        name: "  Partner Sandbox Key  ",
      },
      connection.db,
    );
    const storedApiKey = await connection.db.query.gatewayApiKeys.findFirst({
      where: (table, { eq }) => eq(table.id, createdApiKey.apiKey.id),
    });
    const createdAuditEvents = await connection.db.query.auditEvents.findMany({
      where: (table, { and, eq }) =>
        and(
          eq(table.workspaceId, workspaceId),
          eq(table.projectId, projectId),
          eq(table.eventType, "gateway_api_key.created"),
        ),
      orderBy: (table, { asc }) => [asc(table.createdAt), asc(table.id)],
    });

    assert.match(createdApiKey.rawKey, /^nl_[A-Za-z0-9_-]+$/);
    assert.equal(createdApiKey.apiKey.projectId, projectId);
    assert.equal(createdApiKey.apiKey.name, "Partner Sandbox Key");
    assert.equal(
      createdApiKey.apiKey.keyPrefix,
      getGatewayApiKeyPrefix(createdApiKey.rawKey),
    );
    assert.ok(storedApiKey);
    assert.equal(storedApiKey?.projectId, projectId);
    assert.equal(
      storedApiKey?.keyPrefix,
      getGatewayApiKeyPrefix(createdApiKey.rawKey),
    );
    assert.equal(
      storedApiKey?.keyHash,
      hashGatewayApiKey(createdApiKey.rawKey),
    );
    assert.notEqual(storedApiKey?.keyHash, createdApiKey.rawKey);
    assert.equal(createdAuditEvents.length, 1);
    assert.deepEqual(createdAuditEvents[0]?.eventPayload, {
      message: "Created gateway API key Partner Sandbox Key.",
      name: "Partner Sandbox Key",
      key_prefix: getGatewayApiKeyPrefix(createdApiKey.rawKey),
      status: "active",
      scope: "project",
    });
  } finally {
    await cleanupWorkspace(connection.db, workspaceId);
  }
});

test("listProjectGatewayApiKeys stays project-scoped, includes revoked and expired keys, and exposes last_used_at", async (t) => {
  const connection = await openIntegrationDatabase(t);

  if (!connection) {
    return;
  }

  const suffix = randomUUID().slice(0, 8);
  const workspaceId = await insertWorkspace(connection.db, suffix);
  const projectId = `proj_gateway_list_${suffix}`;
  const otherProjectId = `proj_gateway_list_other_${suffix}`;

  try {
    await insertProject(connection.db, {
      workspaceId,
      projectId,
    });
    await insertProject(connection.db, {
      workspaceId,
      projectId: otherProjectId,
    });

    const activeApiKey = await createProjectGatewayApiKey(
      {
        workspaceId,
        projectId,
        name: "Primary Request Key",
      },
      connection.db,
    );
    const revokedApiKey = await createProjectGatewayApiKey(
      {
        workspaceId,
        projectId,
        name: "Revoked Request Key",
      },
      connection.db,
    );

    await revokeProjectGatewayApiKey(
      {
        workspaceId,
        projectId,
        apiKeyId: revokedApiKey.apiKey.id,
      },
      connection.db,
    );
    await connection.db
      .update(gatewayApiKeys)
      .set({
        createdAt: new Date("2026-03-25T09:00:00.000Z"),
        updatedAt: new Date("2026-03-25T09:00:00.000Z"),
      })
      .where(eq(gatewayApiKeys.id, revokedApiKey.apiKey.id));

    const expiredApiKeyId = await insertGatewayApiKey(connection.db, {
      workspaceId,
      projectId,
      name: "Expired Request Key",
      rawKey: `nl_expired_${suffix}`,
      status: "expired",
      createdAt: new Date("2026-03-25T09:30:00.000Z"),
    });

    await insertGatewayApiKey(connection.db, {
      workspaceId,
      projectId: null,
      name: "Workspace Legacy Key",
      rawKey: `nl_workspace_${suffix}`,
      status: "active",
      createdAt: new Date("2026-03-25T09:40:00.000Z"),
    });
    await insertGatewayApiKey(connection.db, {
      workspaceId,
      projectId: otherProjectId,
      name: "Other Project Key",
      rawKey: `nl_other_project_${suffix}`,
      status: "active",
      createdAt: new Date("2026-03-25T09:45:00.000Z"),
    });

    await touchGatewayApiKeyLastUsedAt(
      activeApiKey.apiKey.id,
      {
        now: new Date("2026-03-25T10:00:00.000Z"),
      },
      connection.db,
    );

    const summaries = await listProjectGatewayApiKeys(
      {
        workspaceId,
        projectId,
      },
      connection.db,
    );

    assert.deepEqual(
      summaries.map((summary) => [summary.name, summary.status]),
      [
        ["Primary Request Key", "active"],
        ["Expired Request Key", "expired"],
        ["Revoked Request Key", "revoked"],
      ],
    );
    assert.equal(
      summaries.find((summary) => summary.id === activeApiKey.apiKey.id)
        ?.lastUsedAt,
      "2026-03-25T10:00:00.000Z",
    );
    assert.equal(
      summaries.find((summary) => summary.id === expiredApiKeyId)?.projectId,
      projectId,
    );
  } finally {
    await cleanupWorkspace(connection.db, workspaceId);
  }
});

test("revokeProjectGatewayApiKey is idempotent and writes a single revoke audit event", async (t) => {
  const connection = await openIntegrationDatabase(t);

  if (!connection) {
    return;
  }

  const suffix = randomUUID().slice(0, 8);
  const workspaceId = await insertWorkspace(connection.db, suffix);
  const projectId = `proj_gateway_revoke_${suffix}`;

  try {
    await insertProject(connection.db, {
      workspaceId,
      projectId,
    });

    const createdApiKey = await createProjectGatewayApiKey(
      {
        workspaceId,
        projectId,
        name: "Revocable Key",
      },
      connection.db,
    );

    const revokedApiKey = await revokeProjectGatewayApiKey(
      {
        workspaceId,
        projectId,
        apiKeyId: createdApiKey.apiKey.id,
      },
      connection.db,
    );
    const revokedApiKeyAgain = await revokeProjectGatewayApiKey(
      {
        workspaceId,
        projectId,
        apiKeyId: createdApiKey.apiKey.id,
      },
      connection.db,
    );
    const revokeAuditEvents = await connection.db.query.auditEvents.findMany({
      where: (table, { and, eq }) =>
        and(
          eq(table.workspaceId, workspaceId),
          eq(table.projectId, projectId),
          eq(table.eventType, "gateway_api_key.revoked"),
        ),
      orderBy: (table, { asc }) => [asc(table.createdAt), asc(table.id)],
    });

    assert.equal(revokedApiKey.status, "revoked");
    assert.equal(revokedApiKeyAgain.status, "revoked");
    assert.equal(revokeAuditEvents.length, 1);
    assert.equal(revokeAuditEvents[0]?.entityId, createdApiKey.apiKey.id);
    assert.equal(
      (revokeAuditEvents[0]?.eventPayload as { scope?: string })?.scope,
      "project",
    );
  } finally {
    await cleanupWorkspace(connection.db, workspaceId);
  }
});

test("gateway API key lifecycle services return typed errors for invalid scope and names", async (t) => {
  const connection = await openIntegrationDatabase(t);

  if (!connection) {
    return;
  }

  const suffix = randomUUID().slice(0, 8);
  const workspaceId = await insertWorkspace(connection.db, suffix);
  const projectId = `proj_gateway_errors_${suffix}`;
  const inactiveProjectId = `proj_gateway_errors_inactive_${suffix}`;

  try {
    await insertProject(connection.db, {
      workspaceId,
      projectId,
    });
    await insertProject(connection.db, {
      workspaceId,
      projectId: inactiveProjectId,
      status: "inactive",
    });

    const workspaceLevelApiKeyId = await insertGatewayApiKey(connection.db, {
      workspaceId,
      projectId: null,
      name: "Legacy Workspace Key",
      rawKey: `nl_workspace_error_${suffix}`,
    });

    await assert.rejects(
      createProjectGatewayApiKey(
        {
          workspaceId: `ws_missing_${suffix}`,
          projectId,
          name: "Missing Workspace Key",
        },
        connection.db,
      ),
      (error: unknown) =>
        error instanceof GatewayApiKeyLifecycleError &&
        error.code === "workspace_not_found",
    );
    await assert.rejects(
      createProjectGatewayApiKey(
        {
          workspaceId,
          projectId,
          name: "   ",
        },
        connection.db,
      ),
      (error: unknown) =>
        error instanceof GatewayApiKeyLifecycleError &&
        error.code === "invalid_api_key_name",
    );
    await assert.rejects(
      createProjectGatewayApiKey(
        {
          workspaceId,
          projectId: inactiveProjectId,
          name: "Inactive Project Key",
        },
        connection.db,
      ),
      (error: unknown) =>
        error instanceof GatewayApiKeyLifecycleError &&
        error.code === "project_inactive",
    );
    await assert.rejects(
      listProjectGatewayApiKeys(
        {
          workspaceId,
          projectId: `proj_missing_${suffix}`,
        },
        connection.db,
      ),
      (error: unknown) =>
        error instanceof GatewayApiKeyLifecycleError &&
        error.code === "project_not_found",
    );
    await assert.rejects(
      revokeProjectGatewayApiKey(
        {
          workspaceId,
          projectId,
          apiKeyId: workspaceLevelApiKeyId,
        },
        connection.db,
      ),
      (error: unknown) =>
        error instanceof GatewayApiKeyLifecycleError &&
        error.code === "api_key_not_found",
    );
  } finally {
    await cleanupWorkspace(connection.db, workspaceId);
  }
});
