import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { type TestContext, test } from "node:test";

import { loadDatabaseConfig } from "@neuralayer/config";
import { eq } from "drizzle-orm";

import { listRecentWorkspaceAuditEvents } from "./admin-service";
import { getAuditCsvExport } from "./audit-csv-export-service";
import { createDbConnection, type Database } from "./client";
import {
  getLatestManualRequestFeedback,
  ManualRequestFeedbackError,
  type ManualRequestFeedbackValue,
  upsertManualRequestFeedback,
} from "./manual-request-feedback-service";
import { getRequestsPageData } from "./requests-page-service";
import {
  auditEvents,
  gatewayApiKeys,
  projects,
  requests,
  workspaces,
} from "./schema";

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

async function insertRequestFixture(database: Database, suffix: string) {
  const workspaceId = `ws_manual_feedback_${suffix}`;
  const projectId = `proj_manual_feedback_${suffix}`;
  const apiKeyId = `gak_manual_feedback_${suffix}`;
  const requestId = `req_manual_feedback_${suffix}`;

  await database.insert(workspaces).values({
    id: workspaceId,
    name: `Manual Feedback Workspace ${suffix}`,
    slug: `manual-feedback-${suffix}`,
    status: "active",
    defaultMode: "balanced",
  });

  await database.insert(projects).values({
    id: projectId,
    workspaceId,
    name: `Manual Feedback Project ${suffix}`,
    slug: `manual-feedback-project-${suffix}`,
    status: "active",
    defaultMode: "balanced",
  });

  await database.insert(gatewayApiKeys).values({
    id: apiKeyId,
    workspaceId,
    projectId,
    name: `Manual Feedback Key ${suffix}`,
    keyPrefix: `nl_mf_${suffix}`,
    keyHash: `hash_mf_${suffix}`,
    status: "active",
  });

  await database.insert(requests).values({
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
      message_count: 1,
      message_roles: ["user"],
      metadata_keys: ["source"],
      prompt_redacted: true,
    },
    requestMetadata: {
      source: "manual-request-feedback-test",
    },
    startedAt: new Date("2026-03-31T10:00:00.000Z"),
    completedAt: new Date("2026-03-31T10:00:02.000Z"),
  });

  return {
    workspaceId,
    projectId,
    apiKeyId,
    requestId,
  };
}

async function cleanupWorkspace(database: Database, workspaceId: string) {
  await database
    .delete(auditEvents)
    .where(eq(auditEvents.workspaceId, workspaceId));
  await database.delete(requests).where(eq(requests.workspaceId, workspaceId));
  await database
    .delete(gatewayApiKeys)
    .where(eq(gatewayApiKeys.workspaceId, workspaceId));
  await database.delete(projects).where(eq(projects.workspaceId, workspaceId));
  await database.delete(workspaces).where(eq(workspaces.id, workspaceId));
}

test("upsertManualRequestFeedback creates a metadata-first audit event and getLatestManualRequestFeedback reads it back", async (t) => {
  const connection = await openIntegrationDatabase(t);

  if (!connection) {
    return;
  }

  const suffix = randomUUID().slice(0, 8);
  const fixture = await insertRequestFixture(connection.db, suffix);
  const recordedAt = new Date("2026-03-31T11:00:00.000Z");

  try {
    const storedFeedback = await upsertManualRequestFeedback(
      {
        workspaceId: fixture.workspaceId,
        requestId: fixture.requestId,
        value: "useful",
        note: "Helped the pilot review.",
        recordedAt,
      },
      connection.db,
    );
    const latestFeedback = await getLatestManualRequestFeedback(
      {
        workspaceId: fixture.workspaceId,
        requestId: fixture.requestId,
      },
      connection.db,
    );
    const auditRows = await connection.db.query.auditEvents.findMany({
      where: (table, { and: queryAnd, eq: queryEq }) =>
        queryAnd(
          queryEq(table.workspaceId, fixture.workspaceId),
          queryEq(table.entityType, "request"),
          queryEq(table.entityId, fixture.requestId),
          queryEq(table.eventType, "request.feedback_recorded"),
        ),
      orderBy: (table, { asc: queryAsc }) => [
        queryAsc(table.createdAt),
        queryAsc(table.id),
      ],
    });

    assert.deepEqual(storedFeedback, {
      auditEventId: storedFeedback.auditEventId,
      workspaceId: fixture.workspaceId,
      projectId: fixture.projectId,
      requestId: fixture.requestId,
      value: "useful",
      note: "Helped the pilot review.",
      recordedAt: recordedAt.toISOString(),
    });
    assert.deepEqual(latestFeedback, storedFeedback);
    assert.equal(auditRows.length, 1);
    assert.deepEqual(auditRows[0]?.eventPayload, {
      message: "Recorded manual request feedback: useful.",
      feedback: {
        value: "useful",
        note: "Helped the pilot review.",
      },
      metadata: {
        source: "admin_surface_manual",
      },
    });
  } finally {
    await cleanupWorkspace(connection.db, fixture.workspaceId);
  }
});

test("upsertManualRequestFeedback appends a newer event when the feedback changes and latest wins", async (t) => {
  const connection = await openIntegrationDatabase(t);

  if (!connection) {
    return;
  }

  const suffix = randomUUID().slice(0, 8);
  const fixture = await insertRequestFixture(connection.db, suffix);

  try {
    await upsertManualRequestFeedback(
      {
        workspaceId: fixture.workspaceId,
        requestId: fixture.requestId,
        value: "useful",
        note: "Initial positive signal.",
        recordedAt: new Date("2026-03-31T11:00:00.000Z"),
      },
      connection.db,
    );
    const updatedFeedback = await upsertManualRequestFeedback(
      {
        workspaceId: fixture.workspaceId,
        requestId: fixture.requestId,
        value: "needs_follow_up",
        note: "Need stronger benchmark evidence.",
        recordedAt: new Date("2026-03-31T11:05:00.000Z"),
      },
      connection.db,
    );
    const latestFeedback = await getLatestManualRequestFeedback(
      {
        workspaceId: fixture.workspaceId,
        requestId: fixture.requestId,
      },
      connection.db,
    );
    const auditRows = await connection.db.query.auditEvents.findMany({
      where: (table, { and: queryAnd, eq: queryEq }) =>
        queryAnd(
          queryEq(table.workspaceId, fixture.workspaceId),
          queryEq(table.entityType, "request"),
          queryEq(table.entityId, fixture.requestId),
          queryEq(table.eventType, "request.feedback_recorded"),
        ),
      orderBy: (table, { asc: queryAsc }) => [
        queryAsc(table.createdAt),
        queryAsc(table.id),
      ],
    });

    assert.equal(auditRows.length, 2);
    assert.deepEqual(latestFeedback, updatedFeedback);
    assert.equal(updatedFeedback.value, "needs_follow_up");
    assert.equal(updatedFeedback.note, "Need stronger benchmark evidence.");
    assert.equal(updatedFeedback.recordedAt, "2026-03-31T11:05:00.000Z");
  } finally {
    await cleanupWorkspace(connection.db, fixture.workspaceId);
  }
});

test("upsertManualRequestFeedback treats identical resubmits as a no-op", async (t) => {
  const connection = await openIntegrationDatabase(t);

  if (!connection) {
    return;
  }

  const suffix = randomUUID().slice(0, 8);
  const fixture = await insertRequestFixture(connection.db, suffix);

  try {
    const initialFeedback = await upsertManualRequestFeedback(
      {
        workspaceId: fixture.workspaceId,
        requestId: fixture.requestId,
        value: "not_useful",
        note: "Too noisy for the manager recap.",
        recordedAt: new Date("2026-03-31T11:00:00.000Z"),
      },
      connection.db,
    );
    const repeatedFeedback = await upsertManualRequestFeedback(
      {
        workspaceId: fixture.workspaceId,
        requestId: fixture.requestId,
        value: "not_useful",
        note: "  Too noisy for the manager recap.  ",
        recordedAt: new Date("2026-03-31T11:10:00.000Z"),
      },
      connection.db,
    );
    const auditRows = await connection.db.query.auditEvents.findMany({
      where: (table, { and: queryAnd, eq: queryEq }) =>
        queryAnd(
          queryEq(table.workspaceId, fixture.workspaceId),
          queryEq(table.entityType, "request"),
          queryEq(table.entityId, fixture.requestId),
          queryEq(table.eventType, "request.feedback_recorded"),
        ),
    });

    assert.deepEqual(repeatedFeedback, initialFeedback);
    assert.equal(auditRows.length, 1);
  } finally {
    await cleanupWorkspace(connection.db, fixture.workspaceId);
  }
});

test("upsertManualRequestFeedback rejects missing requests, invalid values, and notes longer than 280 characters", async (t) => {
  const connection = await openIntegrationDatabase(t);

  if (!connection) {
    return;
  }

  const suffix = randomUUID().slice(0, 8);
  const fixture = await insertRequestFixture(connection.db, suffix);

  try {
    await assert.rejects(
      () =>
        upsertManualRequestFeedback(
          {
            workspaceId: fixture.workspaceId,
            requestId: "req_missing_manual_feedback",
            value: "useful",
          },
          connection.db,
        ),
      (error: unknown) =>
        error instanceof ManualRequestFeedbackError &&
        error.code === "request_not_found",
    );

    await assert.rejects(
      () =>
        upsertManualRequestFeedback(
          {
            workspaceId: fixture.workspaceId,
            requestId: fixture.requestId,
            value: "invalid_feedback" as ManualRequestFeedbackValue,
          },
          connection.db,
        ),
      (error: unknown) =>
        error instanceof ManualRequestFeedbackError &&
        error.code === "invalid_feedback_value",
    );

    await assert.rejects(
      () =>
        upsertManualRequestFeedback(
          {
            workspaceId: fixture.workspaceId,
            requestId: fixture.requestId,
            value: "useful",
            note: "x".repeat(281),
          },
          connection.db,
        ),
      (error: unknown) =>
        error instanceof ManualRequestFeedbackError &&
        error.code === "note_too_long",
    );
  } finally {
    await cleanupWorkspace(connection.db, fixture.workspaceId);
  }
});

test("manual request feedback stays visible in generic audit surfaces and out of runtime request lineage", async (t) => {
  const connection = await openIntegrationDatabase(t);

  if (!connection) {
    return;
  }

  const suffix = randomUUID().slice(0, 8);
  const fixture = await insertRequestFixture(connection.db, suffix);

  try {
    await upsertManualRequestFeedback(
      {
        workspaceId: fixture.workspaceId,
        requestId: fixture.requestId,
        value: "useful",
        note: "Worth sharing with the partner.",
        recordedAt: new Date("2026-03-31T11:15:00.000Z"),
      },
      connection.db,
    );

    const auditFeed = await listRecentWorkspaceAuditEvents(
      {
        workspaceId: fixture.workspaceId,
        limit: 5,
      },
      connection.db,
    );
    const auditExport = await getAuditCsvExport(
      {
        workspaceId: fixture.workspaceId,
        range: "7d",
        now: new Date("2026-04-01T00:00:00.000Z"),
      },
      connection.db,
    );
    const requestsPage = await getRequestsPageData(
      {
        workspaceId: fixture.workspaceId,
      },
      connection.db,
    );

    assert.equal(auditFeed[0]?.eventType, "request.feedback_recorded");
    assert.equal(
      auditFeed[0]?.message,
      "Recorded manual request feedback: useful.",
    );
    assert.equal(auditFeed[0]?.provider, null);
    assert.equal(auditFeed[0]?.requestStatus, null);

    assert.equal(auditExport.rows[0]?.eventType, "request.feedback_recorded");
    assert.equal(
      auditExport.rows[0]?.message,
      "Recorded manual request feedback: useful.",
    );
    assert.equal(auditExport.rows[0]?.requestStatus, "");
    assert.equal(auditExport.rows[0]?.provider, "");
    assert.equal(auditExport.rows[0]?.model, "");

    assert.equal(requestsPage.feed.length, 1);
    assert.equal(requestsPage.feed[0]?.requestId, fixture.requestId);
    assert.equal(requestsPage.feed[0]?.status, "succeeded");
    assert.deepEqual(requestsPage.feed[0]?.manualFeedback, {
      value: "useful",
      note: "Worth sharing with the partner.",
      recordedAt: "2026-03-31T11:15:00.000Z",
    });
    assert.deepEqual(requestsPage.recentAudit, []);
    assert.deepEqual(requestsPage.blockedRecent, []);
  } finally {
    await cleanupWorkspace(connection.db, fixture.workspaceId);
  }
});
