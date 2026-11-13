import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { type TestContext, test } from "node:test";

import { loadDatabaseConfig } from "@neuralayer/config";
import { eq } from "drizzle-orm";

import { createDbConnection } from "./client";
import {
  auditEvents,
  gatewayApiKeys,
  projects,
  providerAccounts,
  requests,
  workspaces,
} from "./schema";
import { getWorkspaceSetupProgress } from "./setup-progress-service";

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

async function insertWorkspace(
  db: ReturnType<typeof createDbConnection>["db"],
  suffix: string,
) {
  const workspaceId = `ws_setup_progress_${suffix}`;

  await db.insert(workspaces).values({
    id: workspaceId,
    name: `Setup Progress ${suffix}`,
    slug: `setup-progress-${suffix}`,
    status: "active",
    defaultMode: "balanced",
  });

  return workspaceId;
}

async function cleanupWorkspace(
  db: ReturnType<typeof createDbConnection>["db"],
  workspaceId: string,
) {
  await db.delete(auditEvents).where(eq(auditEvents.workspaceId, workspaceId));
  await db.delete(requests).where(eq(requests.workspaceId, workspaceId));
  await db
    .delete(gatewayApiKeys)
    .where(eq(gatewayApiKeys.workspaceId, workspaceId));
  await db
    .delete(providerAccounts)
    .where(eq(providerAccounts.workspaceId, workspaceId));
  await db.delete(projects).where(eq(projects.workspaceId, workspaceId));
  await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
}

test("getWorkspaceSetupProgress ignores demo-like project artifacts and placeholder providers", async (t) => {
  const connection = await openIntegrationDatabase(t);

  if (!connection) {
    return;
  }

  const suffix = randomUUID().slice(0, 8);
  const workspaceId = await insertWorkspace(connection.db, suffix);
  const demoProjectId = `proj_setup_progress_demo_${suffix}`;
  const demoApiKeyId = `gak_setup_progress_demo_${suffix}`;

  try {
    await connection.db.insert(projects).values({
      id: demoProjectId,
      workspaceId,
      name: `Demo-like Project ${suffix}`,
      slug: `demo-like-project-${suffix}`,
      status: "active",
      defaultMode: "balanced",
      metadata: {
        isDemo: true,
      },
    });
    await connection.db.insert(gatewayApiKeys).values({
      id: demoApiKeyId,
      workspaceId,
      projectId: demoProjectId,
      name: `Demo-like Key ${suffix}`,
      keyPrefix: `nl_demo_${suffix}`,
      keyHash: `hash_demo_${suffix}`,
      status: "active",
    });
    await connection.db.insert(requests).values({
      id: `req_setup_progress_demo_${suffix}`,
      workspaceId,
      projectId: demoProjectId,
      apiKeyId: demoApiKeyId,
      source: "api",
      mode: "balanced",
      taskType: "general",
      status: "blocked",
      normalizedRequestJson: {
        stream: false,
        message_count: 1,
        message_roles: ["user"],
        metadata_keys: [],
        prompt_redacted: true,
      },
      requestMetadata: {
        source: "setup-progress-demo",
      },
    });
    await connection.db.insert(providerAccounts).values({
      id: `provacc_setup_progress_demo_${suffix}`,
      workspaceId,
      provider: "openai",
      displayName: `OpenAI Demo ${suffix}`,
      status: "active",
      encryptedCredentials: "demo-placeholder-openai-no-real-credentials",
      testStatus: "demo-placeholder",
      metadata: {
        isDemo: true,
      },
    });

    const progress = await getWorkspaceSetupProgress(
      workspaceId,
      connection.db,
    );

    assert.equal(progress.completedStepCount, 0);
    assert.equal(progress.nextStepId, "provider_configured");
    assert.deepEqual(
      progress.steps.map((step) => [step.id, step.completed]),
      [
        ["provider_configured", false],
        ["provider_tested", false],
        ["project_created", false],
        ["api_key_generated", false],
        ["first_request_sent", false],
      ],
    );
  } finally {
    await cleanupWorkspace(connection.db, workspaceId);
  }
});

test("getWorkspaceSetupProgress advances provider setup from configured to tested using a passing explicit test", async (t) => {
  const connection = await openIntegrationDatabase(t);

  if (!connection) {
    return;
  }

  const suffix = randomUUID().slice(0, 8);
  const workspaceId = await insertWorkspace(connection.db, suffix);
  const providerAccountId = `provacc_setup_progress_${suffix}`;

  try {
    await connection.db.insert(providerAccounts).values({
      id: providerAccountId,
      workspaceId,
      provider: "openai",
      displayName: `OpenAI ${suffix}`,
      status: "active",
      encryptedCredentials: '{"apiKey":"sk-setup-progress"}',
      testStatus: "configured",
      createdAt: new Date("2026-03-27T09:00:00.000Z"),
      updatedAt: new Date("2026-03-27T09:00:00.000Z"),
      metadata: {
        credentialMask: "****ress",
      },
    });

    const configuredOnlyProgress = await getWorkspaceSetupProgress(
      workspaceId,
      connection.db,
    );

    assert.equal(configuredOnlyProgress.completedStepCount, 1);
    assert.equal(configuredOnlyProgress.nextStepId, "provider_tested");
    assert.deepEqual(
      configuredOnlyProgress.steps.map((step) => [step.id, step.completed]),
      [
        ["provider_configured", true],
        ["provider_tested", false],
        ["project_created", false],
        ["api_key_generated", false],
        ["first_request_sent", false],
      ],
    );

    await connection.db
      .update(providerAccounts)
      .set({
        testStatus: "ready",
        lastTestedAt: new Date("2026-03-27T09:30:00.000Z"),
        updatedAt: new Date("2026-03-27T09:30:00.000Z"),
      })
      .where(eq(providerAccounts.id, providerAccountId));
    await connection.db.insert(auditEvents).values({
      id: `aud_setup_progress_provider_${suffix}`,
      workspaceId,
      actorType: "system",
      eventType: "provider_account.connection_tested",
      entityType: "provider_account",
      entityId: providerAccountId,
      eventPayload: {
        message: "Provider connection test passed for openai.",
        provider: "openai",
        model: "gpt-5-mini",
        metadata: {
          request_status: "succeeded",
        },
      },
      createdAt: new Date("2026-03-27T09:30:00.000Z"),
    });

    const testedProgress = await getWorkspaceSetupProgress(
      workspaceId,
      connection.db,
    );

    assert.equal(testedProgress.completedStepCount, 2);
    assert.equal(testedProgress.nextStepId, "project_created");
    assert.deepEqual(
      testedProgress.steps.map((step) => [step.id, step.completed]),
      [
        ["provider_configured", true],
        ["provider_tested", true],
        ["project_created", false],
        ["api_key_generated", false],
        ["first_request_sent", false],
      ],
    );
  } finally {
    await cleanupWorkspace(connection.db, workspaceId);
  }
});

test("getWorkspaceSetupProgress requires the explicit provider test to match the current credential", async (t) => {
  const connection = await openIntegrationDatabase(t);

  if (!connection) {
    return;
  }

  const suffix = randomUUID().slice(0, 8);
  const workspaceId = await insertWorkspace(connection.db, suffix);
  const providerAccountId = `provacc_setup_progress_stale_${suffix}`;

  try {
    await connection.db.insert(providerAccounts).values({
      id: providerAccountId,
      workspaceId,
      provider: "openai",
      displayName: `OpenAI stale test ${suffix}`,
      status: "active",
      encryptedCredentials: '{"apiKey":"test-provider-setup-progress-initial"}',
      testStatus: "ready",
      lastTestedAt: new Date("2026-03-27T09:10:00.000Z"),
      createdAt: new Date("2026-03-27T09:00:00.000Z"),
      updatedAt: new Date("2026-03-27T09:10:00.000Z"),
      metadata: {
        credentialMask: "****itial",
        credentialUpdatedAt: "2026-03-27T09:00:00.000Z",
      },
    });
    await connection.db.insert(auditEvents).values({
      id: `aud_setup_progress_stale_provider_${suffix}`,
      workspaceId,
      actorType: "system",
      eventType: "provider_account.connection_tested",
      entityType: "provider_account",
      entityId: providerAccountId,
      eventPayload: {
        message: "Provider connection test passed for openai.",
        provider: "openai",
        model: "gpt-5-mini",
        metadata: {
          request_status: "succeeded",
        },
      },
      createdAt: new Date("2026-03-27T09:10:00.000Z"),
    });

    const testedProgress = await getWorkspaceSetupProgress(
      workspaceId,
      connection.db,
    );

    assert.equal(testedProgress.completedStepCount, 2);
    assert.equal(testedProgress.nextStepId, "project_created");
    assert.deepEqual(
      testedProgress.steps.map((step) => [step.id, step.completed]),
      [
        ["provider_configured", true],
        ["provider_tested", true],
        ["project_created", false],
        ["api_key_generated", false],
        ["first_request_sent", false],
      ],
    );

    await connection.db
      .update(providerAccounts)
      .set({
        encryptedCredentials:
          '{"apiKey":"test-provider-setup-progress-refreshed"}',
        testStatus: "ready",
        lastTestedAt: new Date("2026-03-27T09:10:00.000Z"),
        updatedAt: new Date("2026-03-27T09:20:00.000Z"),
        metadata: {
          credentialMask: "****shed",
          credentialUpdatedAt: "2026-03-27T09:20:00.000Z",
        },
      })
      .where(eq(providerAccounts.id, providerAccountId));

    const staleTestProgress = await getWorkspaceSetupProgress(
      workspaceId,
      connection.db,
    );

    assert.equal(staleTestProgress.completedStepCount, 1);
    assert.equal(staleTestProgress.nextStepId, "provider_tested");
    assert.deepEqual(
      staleTestProgress.steps.map((step) => [step.id, step.completed]),
      [
        ["provider_configured", true],
        ["provider_tested", false],
        ["project_created", false],
        ["api_key_generated", false],
        ["first_request_sent", false],
      ],
    );
  } finally {
    await cleanupWorkspace(connection.db, workspaceId);
  }
});

test("getWorkspaceSetupProgress detects project creation, active project keys, and first requests on non-demo projects", async (t) => {
  const connection = await openIntegrationDatabase(t);

  if (!connection) {
    return;
  }

  const suffix = randomUUID().slice(0, 8);
  const workspaceId = await insertWorkspace(connection.db, suffix);
  const projectId = `proj_setup_progress_${suffix}`;
  const apiKeyId = `gak_setup_progress_${suffix}`;

  try {
    await connection.db.insert(projects).values({
      id: projectId,
      workspaceId,
      name: `Partner Project ${suffix}`,
      slug: `partner-project-${suffix}`,
      status: "active",
      defaultMode: "balanced",
    });

    const projectOnlyProgress = await getWorkspaceSetupProgress(
      workspaceId,
      connection.db,
    );

    assert.equal(projectOnlyProgress.completedStepCount, 1);
    assert.equal(projectOnlyProgress.nextStepId, "provider_configured");
    assert.deepEqual(
      projectOnlyProgress.steps.map((step) => [step.id, step.completed]),
      [
        ["provider_configured", false],
        ["provider_tested", false],
        ["project_created", true],
        ["api_key_generated", false],
        ["first_request_sent", false],
      ],
    );

    await connection.db.insert(gatewayApiKeys).values({
      id: apiKeyId,
      workspaceId,
      projectId,
      name: `Partner Key ${suffix}`,
      keyPrefix: `nl_partner_${suffix}`,
      keyHash: `hash_partner_${suffix}`,
      status: "active",
    });

    const keyProgress = await getWorkspaceSetupProgress(
      workspaceId,
      connection.db,
    );

    assert.equal(keyProgress.completedStepCount, 2);
    assert.deepEqual(
      keyProgress.steps.map((step) => [step.id, step.completed]),
      [
        ["provider_configured", false],
        ["provider_tested", false],
        ["project_created", true],
        ["api_key_generated", true],
        ["first_request_sent", false],
      ],
    );

    await connection.db.insert(requests).values({
      id: `req_setup_progress_${suffix}`,
      workspaceId,
      projectId,
      apiKeyId,
      source: "api",
      mode: "balanced",
      taskType: "general",
      status: "failed",
      normalizedRequestJson: {
        stream: false,
        message_count: 1,
        message_roles: ["user"],
        metadata_keys: ["source"],
        prompt_redacted: true,
      },
      requestMetadata: {
        source: "setup-progress-real",
      },
      startedAt: new Date("2026-03-27T10:00:00.000Z"),
      completedAt: new Date("2026-03-27T10:00:02.000Z"),
    });

    const requestProgress = await getWorkspaceSetupProgress(
      workspaceId,
      connection.db,
    );

    assert.equal(requestProgress.completedStepCount, 3);
    assert.deepEqual(
      requestProgress.steps.map((step) => [step.id, step.completed]),
      [
        ["provider_configured", false],
        ["provider_tested", false],
        ["project_created", true],
        ["api_key_generated", true],
        ["first_request_sent", true],
      ],
    );
  } finally {
    await cleanupWorkspace(connection.db, workspaceId);
  }
});

test("getWorkspaceSetupProgress only counts active non-demo projects, active project keys, and non-demo requests", async (t) => {
  const connection = await openIntegrationDatabase(t);

  if (!connection) {
    return;
  }

  const suffix = randomUUID().slice(0, 8);
  const workspaceId = await insertWorkspace(connection.db, suffix);
  const inactiveProjectId = `proj_setup_progress_inactive_${suffix}`;
  const activeProjectId = `proj_setup_progress_active_${suffix}`;
  const demoProjectId = `proj_setup_progress_demo_active_${suffix}`;
  const inactiveProjectApiKeyId = `gak_setup_progress_inactive_${suffix}`;
  const revokedProjectApiKeyId = `gak_setup_progress_revoked_${suffix}`;
  const activeProjectApiKeyId = `gak_setup_progress_active_${suffix}`;
  const demoProjectApiKeyId = `gak_setup_progress_demo_active_${suffix}`;

  try {
    await connection.db.insert(projects).values([
      {
        id: inactiveProjectId,
        workspaceId,
        name: `Inactive Project ${suffix}`,
        slug: `inactive-project-${suffix}`,
        status: "inactive",
        defaultMode: "balanced",
      },
      {
        id: demoProjectId,
        workspaceId,
        name: `Demo Active Project ${suffix}`,
        slug: `demo-active-project-${suffix}`,
        status: "active",
        defaultMode: "balanced",
        metadata: {
          isDemo: true,
        },
      },
    ]);
    await connection.db.insert(gatewayApiKeys).values([
      {
        id: inactiveProjectApiKeyId,
        workspaceId,
        projectId: inactiveProjectId,
        name: `Inactive Project Key ${suffix}`,
        keyPrefix: `nl_inactive_${suffix}`,
        keyHash: `hash_inactive_${suffix}`,
        status: "active",
      },
      {
        id: demoProjectApiKeyId,
        workspaceId,
        projectId: demoProjectId,
        name: `Demo Project Key ${suffix}`,
        keyPrefix: `nl_demo_active_${suffix}`,
        keyHash: `hash_demo_active_${suffix}`,
        status: "active",
      },
    ]);
    await connection.db.insert(requests).values({
      id: `req_setup_progress_demo_only_${suffix}`,
      workspaceId,
      projectId: demoProjectId,
      apiKeyId: demoProjectApiKeyId,
      source: "api",
      mode: "balanced",
      taskType: "general",
      status: "succeeded",
      normalizedRequestJson: {
        stream: false,
        message_count: 1,
        message_roles: ["user"],
        metadata_keys: [],
        prompt_redacted: true,
      },
      requestMetadata: {
        source: "setup-progress-demo-only",
      },
      startedAt: new Date("2026-03-27T10:00:00.000Z"),
      completedAt: new Date("2026-03-27T10:00:01.000Z"),
    });

    const ignoredProgress = await getWorkspaceSetupProgress(
      workspaceId,
      connection.db,
    );

    assert.equal(ignoredProgress.completedStepCount, 0);
    assert.deepEqual(
      ignoredProgress.steps.map((step) => [step.id, step.completed]),
      [
        ["provider_configured", false],
        ["provider_tested", false],
        ["project_created", false],
        ["api_key_generated", false],
        ["first_request_sent", false],
      ],
    );

    await connection.db.insert(projects).values({
      id: activeProjectId,
      workspaceId,
      name: `Active Project ${suffix}`,
      slug: `active-project-${suffix}`,
      status: "active",
      defaultMode: "balanced",
    });

    const projectOnlyProgress = await getWorkspaceSetupProgress(
      workspaceId,
      connection.db,
    );

    assert.equal(projectOnlyProgress.completedStepCount, 1);
    assert.deepEqual(
      projectOnlyProgress.steps.map((step) => [step.id, step.completed]),
      [
        ["provider_configured", false],
        ["provider_tested", false],
        ["project_created", true],
        ["api_key_generated", false],
        ["first_request_sent", false],
      ],
    );

    await connection.db.insert(gatewayApiKeys).values({
      id: revokedProjectApiKeyId,
      workspaceId,
      projectId: activeProjectId,
      name: `Revoked Project Key ${suffix}`,
      keyPrefix: `nl_revoked_${suffix}`,
      keyHash: `hash_revoked_${suffix}`,
      status: "revoked",
    });

    const revokedKeyProgress = await getWorkspaceSetupProgress(
      workspaceId,
      connection.db,
    );

    assert.equal(revokedKeyProgress.completedStepCount, 1);
    assert.deepEqual(
      revokedKeyProgress.steps.map((step) => [step.id, step.completed]),
      [
        ["provider_configured", false],
        ["provider_tested", false],
        ["project_created", true],
        ["api_key_generated", false],
        ["first_request_sent", false],
      ],
    );

    await connection.db.insert(gatewayApiKeys).values({
      id: activeProjectApiKeyId,
      workspaceId,
      projectId: activeProjectId,
      name: `Active Project Key ${suffix}`,
      keyPrefix: `nl_active_${suffix}`,
      keyHash: `hash_active_${suffix}`,
      status: "active",
    });

    const activeKeyProgress = await getWorkspaceSetupProgress(
      workspaceId,
      connection.db,
    );

    assert.equal(activeKeyProgress.completedStepCount, 2);
    assert.deepEqual(
      activeKeyProgress.steps.map((step) => [step.id, step.completed]),
      [
        ["provider_configured", false],
        ["provider_tested", false],
        ["project_created", true],
        ["api_key_generated", true],
        ["first_request_sent", false],
      ],
    );

    await connection.db.insert(requests).values({
      id: `req_setup_progress_real_${suffix}`,
      workspaceId,
      projectId: activeProjectId,
      apiKeyId: activeProjectApiKeyId,
      source: "api",
      mode: "balanced",
      taskType: "general",
      status: "failed",
      normalizedRequestJson: {
        stream: false,
        message_count: 1,
        message_roles: ["user"],
        metadata_keys: ["source"],
        prompt_redacted: true,
      },
      requestMetadata: {
        source: "setup-progress-real",
      },
      startedAt: new Date("2026-03-27T10:10:00.000Z"),
      completedAt: new Date("2026-03-27T10:10:02.000Z"),
    });

    const requestProgress = await getWorkspaceSetupProgress(
      workspaceId,
      connection.db,
    );

    assert.equal(requestProgress.completedStepCount, 3);
    assert.deepEqual(
      requestProgress.steps.map((step) => [step.id, step.completed]),
      [
        ["provider_configured", false],
        ["provider_tested", false],
        ["project_created", true],
        ["api_key_generated", true],
        ["first_request_sent", true],
      ],
    );
  } finally {
    await cleanupWorkspace(connection.db, workspaceId);
  }
});
