import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { type TestContext, test } from "node:test";

import { loadDatabaseConfig } from "@neuralayer/config";
import { eq } from "drizzle-orm";

import { getAuditCsvExport } from "./audit-csv-export-service";
import { createDbConnection } from "./client";
import { upsertManualRequestFeedback } from "./manual-request-feedback-service";
import { getRequestsCsvExport } from "./requests-csv-export-service";
import { getRequestsPageData } from "./requests-page-service";
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

async function seedRequestsPageFixture(
  db: ReturnType<typeof createDbConnection>["db"],
  suffix: string,
) {
  const workspaceId = `ws_requests_page_${suffix}`;
  const projectPrimaryId = `proj_requests_primary_${suffix}`;
  const projectSecondaryId = `proj_requests_secondary_${suffix}`;
  const apiKeyPrimaryId = `gak_requests_primary_${suffix}`;
  const apiKeySecondaryId = `gak_requests_secondary_${suffix}`;
  const providerAccountId = `provacc_requests_${suffix}`;
  const successRequestId = `req_requests_success_${suffix}`;
  const successAttemptId = `attempt_requests_success_${suffix}`;
  const failedRequestId = `req_requests_failed_${suffix}`;
  const failedAttemptId = `attempt_requests_failed_${suffix}`;
  const blockedRequestId = `req_requests_blocked_${suffix}`;

  await db.insert(workspaces).values({
    id: workspaceId,
    name: `Requests Workspace ${suffix}`,
    slug: `requests-workspace-${suffix}`,
    status: "active",
    defaultMode: "balanced",
  });

  await db.insert(projects).values([
    {
      id: projectPrimaryId,
      workspaceId,
      name: `Requests Primary ${suffix}`,
      slug: `requests-primary-${suffix}`,
      status: "active",
      defaultMode: "balanced",
    },
    {
      id: projectSecondaryId,
      workspaceId,
      name: `Requests Secondary ${suffix}`,
      slug: `requests-secondary-${suffix}`,
      status: "active",
      defaultMode: "balanced",
    },
  ]);

  await db.insert(gatewayApiKeys).values([
    {
      id: apiKeyPrimaryId,
      workspaceId,
      projectId: projectPrimaryId,
      name: `Requests Primary Key ${suffix}`,
      keyPrefix: `nl_req_p_${suffix}`,
      keyHash: `hash_req_p_${suffix}`,
      status: "active",
    },
    {
      id: apiKeySecondaryId,
      workspaceId,
      projectId: projectSecondaryId,
      name: `Requests Secondary Key ${suffix}`,
      keyPrefix: `nl_req_s_${suffix}`,
      keyHash: `hash_req_s_${suffix}`,
      status: "active",
    },
  ]);

  await db.insert(providerAccounts).values({
    id: providerAccountId,
    workspaceId,
    provider: "openai",
    displayName: `Requests OpenAI ${suffix}`,
    status: "active",
    encryptedCredentials: '{"apiKey":"sk-requests-demo"}',
    testStatus: "ready",
  });

  await db.insert(requests).values([
    {
      id: successRequestId,
      workspaceId,
      projectId: projectPrimaryId,
      apiKeyId: apiKeyPrimaryId,
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
        source: "requests-page-success",
      },
      startedAt: new Date("2026-03-26T10:00:00.000Z"),
      completedAt: new Date("2026-03-26T10:00:03.000Z"),
    },
    {
      id: failedRequestId,
      workspaceId,
      projectId: projectSecondaryId,
      apiKeyId: apiKeySecondaryId,
      source: "api",
      mode: "max_quality",
      taskType: "general",
      status: "running",
      normalizedRequestJson: {
        stream: false,
        messages: [
          {
            role: "user",
            content: "Do not expose failed prompt",
          },
        ],
      },
      requestMetadata: {
        source: "requests-page-failed",
      },
      startedAt: new Date("2026-03-26T10:01:00.000Z"),
      completedAt: new Date("2026-03-26T10:01:04.000Z"),
    },
    {
      id: blockedRequestId,
      workspaceId,
      projectId: projectPrimaryId,
      apiKeyId: apiKeyPrimaryId,
      source: "api",
      mode: "budget",
      taskType: "general",
      status: "running",
      normalizedRequestJson: {
        stream: false,
        messages: [
          {
            role: "user",
            content: "Do not expose blocked prompt",
          },
        ],
      },
      requestMetadata: {
        source: "requests-page-blocked",
      },
      startedAt: new Date("2026-03-26T10:02:00.000Z"),
      completedAt: null,
    },
  ]);

  await db.insert(requestAttempts).values([
    {
      id: successAttemptId,
      requestId: successRequestId,
      workspaceId,
      projectId: projectPrimaryId,
      providerAccountId,
      provider: "openai",
      modelId: "gpt-5-mini",
      attemptNumber: 1,
      selectionReason:
        "Selected the best balanced candidate for cost and latency.",
      status: "succeeded",
      startedAt: new Date("2026-03-26T10:00:01.000Z"),
      completedAt: new Date("2026-03-26T10:00:02.000Z"),
      latencyMs: 321,
      providerRequestId: `provider_success_${suffix}`,
    },
    {
      id: failedAttemptId,
      requestId: failedRequestId,
      workspaceId,
      projectId: projectSecondaryId,
      providerAccountId,
      provider: "openai",
      modelId: "gpt-5.2",
      attemptNumber: 1,
      selectionReason: "Chose the highest quality candidate still available.",
      status: "failed",
      startedAt: new Date("2026-03-26T10:01:01.000Z"),
      completedAt: new Date("2026-03-26T10:01:03.000Z"),
      latencyMs: 987,
      errorType: "timeout",
      errorCode: "provider_timeout",
      errorMessage: "The provider timed out before completion.",
      providerRequestId: `provider_failed_${suffix}`,
    },
  ]);

  await db.insert(usageRecords).values({
    id: `usage_requests_success_${suffix}`,
    workspaceId,
    projectId: projectPrimaryId,
    requestId: successRequestId,
    attemptId: successAttemptId,
    provider: "openai",
    modelId: "gpt-5-mini",
    usageSource: "estimated",
    inputTokens: 120,
    outputTokens: 45,
    totalTokens: 165,
    costTotal: "0.42000000",
    currency: "USD",
    pricingVersion: "catalog_cost_tier_v1",
    recordedAt: new Date("2026-03-26T10:00:02.000Z"),
  });

  await db.insert(auditEvents).values([
    {
      id: `audit_requests_success_routing_${suffix}`,
      workspaceId,
      projectId: projectPrimaryId,
      actorType: "api_key",
      actorApiKeyId: apiKeyPrimaryId,
      eventType: "chat.routing.decision",
      entityType: "request",
      entityId: successRequestId,
      eventPayload: {
        message: "Selected the best balanced candidate for cost and latency.",
        routing_decision: {
          outcome: "selected",
          selectionReasonCode: "best_score_for_mode",
          selectionReasonText:
            "Selected the best balanced candidate for cost and latency.",
          selected: {
            provider: "openai",
            model: "gpt-5-mini",
          },
        },
      },
      createdAt: new Date("2026-03-26T10:00:00.500Z"),
    },
    {
      id: `audit_requests_success_completed_${suffix}`,
      workspaceId,
      projectId: projectPrimaryId,
      actorType: "api_key",
      actorApiKeyId: apiKeyPrimaryId,
      eventType: "chat.completions.completed",
      entityType: "request",
      entityId: successRequestId,
      eventPayload: {
        message: "Request completed successfully.",
        metadata: {
          mode: "balanced",
          request_status: "succeeded",
          provider: "openai",
          model: "gpt-5-mini",
          latency_ms: 321,
          usage_recorded: true,
          usage_source: "estimated",
          input_tokens: 120,
          output_tokens: 45,
          total_tokens: 165,
          cost_total_usd: 0.42,
          currency: "USD",
          selection_reason_code: "best_score_for_mode",
          selection_reason_text:
            "Selected the best balanced candidate for cost and latency.",
        },
      },
      createdAt: new Date("2026-03-26T10:00:02.500Z"),
    },
    {
      id: `audit_requests_failed_routing_${suffix}`,
      workspaceId,
      projectId: projectSecondaryId,
      actorType: "api_key",
      actorApiKeyId: apiKeySecondaryId,
      eventType: "chat.routing.decision",
      entityType: "request",
      entityId: failedRequestId,
      eventPayload: {
        message: "Chose the highest quality candidate still available.",
        routing_decision: {
          outcome: "selected",
          selectionReasonCode: "best_quality_candidate",
          selectionReasonText:
            "Chose the highest quality candidate still available.",
          selected: {
            provider: "openai",
            model: "gpt-5.2",
          },
        },
      },
      createdAt: new Date("2026-03-26T10:01:00.500Z"),
    },
    {
      id: `audit_requests_failed_failed_${suffix}`,
      workspaceId,
      projectId: projectSecondaryId,
      actorType: "api_key",
      actorApiKeyId: apiKeySecondaryId,
      eventType: "chat.completions.failed",
      entityType: "request",
      entityId: failedRequestId,
      eventPayload: {
        message: "The provider timed out before completion.",
        metadata: {
          mode: "max_quality",
          request_status: "failed",
          provider: "openai",
          model: "gpt-5.2",
          error_type: "timeout",
          error_code: "provider_timeout",
          latency_ms: 987,
          usage_recorded: true,
          usage_source: "estimated",
          input_tokens: 30,
          output_tokens: 15,
          total_tokens: 45,
          cost_total_usd: 0.12,
          currency: "USD",
          selection_reason_code: "best_quality_candidate",
          selection_reason_text:
            "Chose the highest quality candidate still available.",
        },
      },
      createdAt: new Date("2026-03-26T10:01:03.500Z"),
    },
    {
      id: `audit_requests_blocked_routing_${suffix}`,
      workspaceId,
      projectId: projectPrimaryId,
      actorType: "api_key",
      actorApiKeyId: apiKeyPrimaryId,
      eventType: "chat.routing.decision",
      entityType: "request",
      entityId: blockedRequestId,
      eventPayload: {
        message:
          "Blocked because the workspace monthly gateway-recorded budget cap has already been reached.",
        routing_decision: {
          outcome: "blocked",
          selectionReasonCode: "policy_blocked_budget_cap",
          selectionReasonText:
            "Blocked because the workspace monthly gateway-recorded budget cap has already been reached.",
        },
      },
      createdAt: new Date("2026-03-26T10:02:00.500Z"),
    },
    {
      id: `audit_requests_blocked_blocked_${suffix}`,
      workspaceId,
      projectId: projectPrimaryId,
      actorType: "api_key",
      actorApiKeyId: apiKeyPrimaryId,
      eventType: "chat.completions.blocked",
      entityType: "request",
      entityId: blockedRequestId,
      eventPayload: {
        message:
          "Blocked because the workspace monthly gateway-recorded budget cap has already been reached.",
        metadata: {
          mode: "budget",
          request_status: "blocked",
          error_type: "policy_blocked",
          error_code: "policy_blocked_budget_cap",
          selection_reason_code: "policy_blocked_budget_cap",
          selection_reason_text:
            "Blocked because the workspace monthly gateway-recorded budget cap has already been reached.",
        },
      },
      createdAt: new Date("2026-03-26T10:02:01.000Z"),
    },
    {
      id: `audit_requests_blocked_failed_${suffix}`,
      workspaceId,
      projectId: projectPrimaryId,
      actorType: "api_key",
      actorApiKeyId: apiKeyPrimaryId,
      eventType: "chat.completions.failed",
      entityType: "request",
      entityId: blockedRequestId,
      eventPayload: {
        message: "Internal follow-up noise that should not win over the block.",
        metadata: {
          mode: "budget",
          request_status: "failed",
          error_type: "internal_error",
          error_code: "provider_execution_threw",
        },
      },
      createdAt: new Date("2026-03-26T10:02:02.000Z"),
    },
    {
      id: `audit_requests_control_plane_${suffix}`,
      workspaceId,
      projectId: projectPrimaryId,
      actorType: "system",
      eventType: "project.created",
      entityType: "project",
      entityId: projectPrimaryId,
      eventPayload: {
        message: "Created project for unrelated control-plane activity.",
      },
      createdAt: new Date("2026-03-26T10:03:00.000Z"),
    },
  ]);

  return {
    workspaceId,
    projectPrimaryId,
    projectSecondaryId,
    successRequestId,
    failedRequestId,
    blockedRequestId,
  };
}

async function cleanupWorkspaceFixture(
  db: ReturnType<typeof createDbConnection>["db"],
  workspaceId: string,
) {
  await db
    .delete(usageRecords)
    .where(eq(usageRecords.workspaceId, workspaceId));
  await db
    .delete(requestAttempts)
    .where(eq(requestAttempts.workspaceId, workspaceId));
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

test("getRequestsPageData returns a request-centric feed with lineage-safe statuses and secondary context", async (t) => {
  const connection = await openIntegrationDatabase(t);

  if (!connection) {
    return;
  }

  const suffix = randomUUID().slice(0, 8);
  const fixture = await seedRequestsPageFixture(connection.db, suffix);

  try {
    const pageData = await getRequestsPageData(
      {
        workspaceId: fixture.workspaceId,
        limit: 10,
        blockedLimit: 10,
        auditLimit: 10,
      },
      connection.db,
    );

    assert.deepEqual(
      pageData.feed.map((item) => item.requestId),
      [
        fixture.blockedRequestId,
        fixture.failedRequestId,
        fixture.successRequestId,
      ],
    );

    const successItem = pageData.feed.find(
      (item) => item.requestId === fixture.successRequestId,
    );
    const failedItem = pageData.feed.find(
      (item) => item.requestId === fixture.failedRequestId,
    );
    const blockedItem = pageData.feed.find(
      (item) => item.requestId === fixture.blockedRequestId,
    );

    assert.ok(successItem);
    assert.equal(successItem?.status, "succeeded");
    assert.equal(successItem?.provider, "openai");
    assert.equal(successItem?.model, "gpt-5-mini");
    assert.equal(successItem?.latencyMs, 321);
    assert.equal(successItem?.usage?.totalTokens, 165);
    assert.equal(successItem?.usage?.source, "estimated");
    assert.equal(successItem?.cost?.totalUsd, 0.42);
    assert.equal(successItem?.cost?.source, "estimated");
    assert.equal(successItem?.selectionReason.code, "best_score_for_mode");
    assert.equal(successItem?.issue, null);
    assert.equal(successItem?.manualFeedback, null);

    assert.ok(failedItem);
    assert.equal(failedItem?.status, "failed");
    assert.equal(failedItem?.provider, "openai");
    assert.equal(failedItem?.model, "gpt-5.2");
    assert.equal(failedItem?.latencyMs, 987);
    assert.equal(failedItem?.usage?.totalTokens, 45);
    assert.equal(failedItem?.usage?.source, "estimated");
    assert.equal(failedItem?.cost?.totalUsd, 0.12);
    assert.equal(failedItem?.cost?.source, "estimated");
    assert.equal(failedItem?.issue?.kind, "error");
    assert.equal(failedItem?.issue?.code, "provider_timeout");
    assert.equal(failedItem?.issue?.type, "timeout");
    assert.equal(failedItem?.manualFeedback, null);

    assert.ok(blockedItem);
    assert.equal(blockedItem?.status, "blocked");
    assert.equal(blockedItem?.provider, null);
    assert.equal(blockedItem?.model, null);
    assert.equal(blockedItem?.usage, null);
    assert.equal(blockedItem?.cost, null);
    assert.equal(
      blockedItem?.selectionReason.code,
      "policy_blocked_budget_cap",
    );
    assert.equal(blockedItem?.issue?.kind, "blocked");
    assert.equal(blockedItem?.issue?.code, "policy_blocked_budget_cap");
    assert.equal(blockedItem?.issue?.type, "policy_blocked");
    assert.match(
      blockedItem?.issue?.text ?? "",
      /budget cap has already been reached/i,
    );
    assert.equal(blockedItem?.manualFeedback, null);

    assert.equal(pageData.blockedRecent.length, 1);
    assert.equal(
      pageData.blockedRecent[0]?.requestId,
      fixture.blockedRequestId,
    );
    assert.equal(
      pageData.blockedRecent[0]?.reason.code,
      "policy_blocked_budget_cap",
    );

    assert.ok(pageData.recentAudit.length >= 4);
    assert.ok(
      pageData.recentAudit.every((item) =>
        [
          "chat.completions.completed",
          "chat.completions.blocked",
          "chat.completions.failed",
        ].includes(item.eventType),
      ),
    );
    assert.ok(
      pageData.recentAudit.some(
        (item) =>
          item.requestId === fixture.blockedRequestId &&
          item.eventType === "chat.completions.blocked",
      ),
    );

    const serialized = JSON.stringify(pageData);

    assert.ok(!serialized.includes("Do not expose failed prompt"));
    assert.ok(!serialized.includes("Do not expose blocked prompt"));
  } finally {
    await cleanupWorkspaceFixture(connection.db, fixture.workspaceId);
  }
});

test("getRequestsPageData attaches the latest manual feedback only to the matching feed item", async (t) => {
  const connection = await openIntegrationDatabase(t);

  if (!connection) {
    return;
  }

  const suffix = randomUUID().slice(0, 8);
  const fixture = await seedRequestsPageFixture(connection.db, suffix);

  try {
    await upsertManualRequestFeedback(
      {
        workspaceId: fixture.workspaceId,
        requestId: fixture.failedRequestId,
        value: "needs_follow_up",
        note: "Need a partner follow-up on the timeout.",
        recordedAt: new Date("2026-03-26T10:05:00.000Z"),
      },
      connection.db,
    );
    await upsertManualRequestFeedback(
      {
        workspaceId: fixture.workspaceId,
        requestId: fixture.failedRequestId,
        value: "useful",
        note: "Worth carrying into the pilot readout.",
        recordedAt: new Date("2026-03-26T10:06:00.000Z"),
      },
      connection.db,
    );

    const pageData = await getRequestsPageData(
      {
        workspaceId: fixture.workspaceId,
        limit: 10,
        blockedLimit: 10,
        auditLimit: 10,
      },
      connection.db,
    );
    const failedItem = pageData.feed.find(
      (item) => item.requestId === fixture.failedRequestId,
    );
    const successItem = pageData.feed.find(
      (item) => item.requestId === fixture.successRequestId,
    );
    const blockedItem = pageData.feed.find(
      (item) => item.requestId === fixture.blockedRequestId,
    );

    assert.deepEqual(failedItem?.manualFeedback, {
      value: "useful",
      note: "Worth carrying into the pilot readout.",
      recordedAt: "2026-03-26T10:06:00.000Z",
    });
    assert.equal(successItem?.manualFeedback, null);
    assert.equal(blockedItem?.manualFeedback, null);
    assert.equal(pageData.blockedRecent.length, 1);
    assert.equal(
      pageData.recentAudit.some(
        (item) => item.message === "Recorded manual request feedback: useful.",
      ),
      false,
    );
  } finally {
    await cleanupWorkspaceFixture(connection.db, fixture.workspaceId);
  }
});

test("getRequestsPageData backfills succeeded request lineage from runtime audit when attempts and usage are missing", async (t) => {
  const connection = await openIntegrationDatabase(t);

  if (!connection) {
    return;
  }

  const suffix = randomUUID().slice(0, 8);
  const workspaceId = `ws_requests_audit_only_${suffix}`;
  const projectId = `proj_requests_audit_only_${suffix}`;
  const apiKeyId = `gak_requests_audit_only_${suffix}`;
  const requestId = `req_requests_audit_only_${suffix}`;

  try {
    await connection.db.insert(workspaces).values({
      id: workspaceId,
      name: `Requests Audit Only ${suffix}`,
      slug: `requests-audit-only-${suffix}`,
      status: "active",
      defaultMode: "balanced",
    });
    await connection.db.insert(projects).values({
      id: projectId,
      workspaceId,
      name: `Requests Audit Only Project ${suffix}`,
      slug: `requests-audit-only-project-${suffix}`,
      status: "active",
      defaultMode: "balanced",
    });
    await connection.db.insert(gatewayApiKeys).values({
      id: apiKeyId,
      workspaceId,
      projectId,
      name: `Requests Audit Only Key ${suffix}`,
      keyPrefix: `nl_audit_${suffix}`,
      keyHash: `hash_audit_${suffix}`,
      status: "active",
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
            content: "Do not expose audit-only prompt",
          },
        ],
      },
      requestMetadata: {
        source: "requests-audit-only",
      },
      startedAt: new Date("2026-03-27T11:00:00.000Z"),
      completedAt: new Date("2026-03-27T11:00:02.000Z"),
    });
    await connection.db.insert(auditEvents).values({
      id: `audit_requests_audit_only_completed_${suffix}`,
      workspaceId,
      projectId,
      actorType: "api_key",
      actorApiKeyId: apiKeyId,
      eventType: "chat.completions.completed",
      entityType: "request",
      entityId: requestId,
      eventPayload: {
        message: "Completed via runtime audit fallback.",
        metadata: {
          mode: "balanced",
          request_status: "succeeded",
          provider: "anthropic",
          model: "claude-3-5-haiku-20241022",
          latency_ms: 654,
          usage_recorded: true,
          usage_source: "estimated",
          input_tokens: 80,
          output_tokens: 20,
          total_tokens: 100,
          cost_total_usd: 0.31,
          currency: "USD",
          selection_reason_code: "best_quality_candidate",
          selection_reason_text:
            "Recovered the selected provider and outcome from runtime audit metadata.",
        },
      },
      createdAt: new Date("2026-03-27T11:00:02.500Z"),
    });

    const pageData = await getRequestsPageData(
      {
        workspaceId,
        limit: 10,
        auditLimit: 10,
      },
      connection.db,
    );

    assert.deepEqual(
      pageData.feed.map((item) => item.requestId),
      [requestId],
    );
    assert.equal(pageData.blockedRecent.length, 0);
    assert.equal(pageData.recentAudit.length, 1);
    assert.equal(
      pageData.recentAudit[0]?.eventType,
      "chat.completions.completed",
    );

    const item = pageData.feed[0];

    assert.ok(item);
    assert.equal(item?.status, "succeeded");
    assert.equal(item?.provider, "anthropic");
    assert.equal(item?.model, "claude-3-5-haiku-20241022");
    assert.equal(item?.latencyMs, 654);
    assert.equal(item?.usage?.inputTokens, 80);
    assert.equal(item?.usage?.outputTokens, 20);
    assert.equal(item?.usage?.totalTokens, 100);
    assert.equal(item?.usage?.source, "estimated");
    assert.equal(item?.cost?.totalUsd, 0.31);
    assert.equal(item?.cost?.currency, "USD");
    assert.equal(item?.cost?.source, "estimated");
    assert.equal(item?.selectionReason.code, "best_quality_candidate");
    assert.equal(
      item?.selectionReason.text,
      "Recovered the selected provider and outcome from runtime audit metadata.",
    );
    assert.equal(item?.issue, null);

    const serialized = JSON.stringify(pageData);

    assert.ok(!serialized.includes("Do not expose audit-only prompt"));
  } finally {
    await cleanupWorkspaceFixture(connection.db, workspaceId);
  }
});

test("getRequestsCsvExport backfills audit-only request rows from runtime audit metadata", async (t) => {
  const connection = await openIntegrationDatabase(t);

  if (!connection) {
    return;
  }

  const suffix = randomUUID().slice(0, 8);
  const workspaceId = `ws_requests_csv_audit_only_${suffix}`;
  const projectId = `proj_requests_csv_audit_only_${suffix}`;
  const apiKeyId = `gak_requests_csv_audit_only_${suffix}`;
  const requestId = `req_requests_csv_audit_only_${suffix}`;

  try {
    await connection.db.insert(workspaces).values({
      id: workspaceId,
      name: `Requests CSV Audit Only ${suffix}`,
      slug: `requests-csv-audit-only-${suffix}`,
      status: "active",
      defaultMode: "balanced",
    });
    await connection.db.insert(projects).values({
      id: projectId,
      workspaceId,
      name: `Requests CSV Audit Only Project ${suffix}`,
      slug: `requests-csv-audit-only-project-${suffix}`,
      status: "active",
      defaultMode: "balanced",
    });
    await connection.db.insert(gatewayApiKeys).values({
      id: apiKeyId,
      workspaceId,
      projectId,
      name: `Requests CSV Audit Only Key ${suffix}`,
      keyPrefix: `nl_csv_audit_${suffix}`,
      keyHash: `hash_csv_audit_${suffix}`,
      status: "active",
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
            content: "Do not expose CSV audit-only prompt",
          },
        ],
      },
      requestMetadata: {
        source: "requests-csv-audit-only",
      },
      startedAt: new Date("2026-03-27T11:00:00.000Z"),
      completedAt: new Date("2026-03-27T11:00:02.000Z"),
    });
    await connection.db.insert(auditEvents).values({
      id: `audit_requests_csv_audit_only_completed_${suffix}`,
      workspaceId,
      projectId,
      actorType: "api_key",
      actorApiKeyId: apiKeyId,
      eventType: "chat.completions.completed",
      entityType: "request",
      entityId: requestId,
      eventPayload: {
        message: "Completed via runtime audit fallback for Requests CSV.",
        metadata: {
          mode: "balanced",
          request_status: "succeeded",
          provider: "anthropic",
          model: "claude-3-5-haiku-20241022",
          latency_ms: 654,
          usage_recorded: true,
          usage_source: "estimated",
          input_tokens: 80,
          output_tokens: 20,
          total_tokens: 100,
          cost_total_usd: 0.31,
          currency: "USD",
          selection_reason_code: "best_quality_candidate",
          selection_reason_text:
            "Recovered the selected provider and outcome from runtime audit metadata.",
        },
      },
      createdAt: new Date("2026-03-27T11:00:02.500Z"),
    });

    const exportData = await getRequestsCsvExport(
      {
        workspaceId,
        range: "7d",
        now: new Date("2026-03-31T12:00:00.000Z"),
      },
      connection.db,
    );

    assert.equal(exportData.rows.length, 1);
    assert.deepEqual(exportData.rows[0], {
      timestamp: "2026-03-27T11:00:00.000Z",
      project: `Requests CSV Audit Only Project ${suffix}`,
      mode: "Balanced",
      provider: "Anthropic",
      model: "claude-3-5-haiku-20241022",
      status: "Succeeded",
      latency: "654 ms",
      usage: "100 total tokens",
      cost: "$0.31",
      selectionReason:
        "Recovered the selected provider and outcome from runtime audit metadata.",
      issueSummary: "",
    });

    const serialized = JSON.stringify(exportData);

    assert.ok(!serialized.includes("Do not expose CSV audit-only prompt"));
  } finally {
    await cleanupWorkspaceFixture(connection.db, workspaceId);
  }
});

test("getRequestsPageData applies project and derived status filters", async (t) => {
  const connection = await openIntegrationDatabase(t);

  if (!connection) {
    return;
  }

  const suffix = randomUUID().slice(0, 8);
  const fixture = await seedRequestsPageFixture(connection.db, suffix);

  try {
    const blockedOnly = await getRequestsPageData(
      {
        workspaceId: fixture.workspaceId,
        status: "blocked",
        limit: 10,
      },
      connection.db,
    );
    const projectPrimaryOnly = await getRequestsPageData(
      {
        workspaceId: fixture.workspaceId,
        projectId: fixture.projectPrimaryId,
        limit: 10,
        blockedLimit: 10,
        auditLimit: 10,
      },
      connection.db,
    );

    assert.deepEqual(
      blockedOnly.feed.map((item) => item.requestId),
      [fixture.blockedRequestId],
    );
    assert.equal(blockedOnly.feed[0]?.status, "blocked");

    assert.deepEqual(
      projectPrimaryOnly.feed.map((item) => item.requestId),
      [fixture.blockedRequestId, fixture.successRequestId],
    );
    assert.ok(
      projectPrimaryOnly.feed.every(
        (item) => item.project.id === fixture.projectPrimaryId,
      ),
    );
    assert.equal(projectPrimaryOnly.blockedRecent.length, 1);
    assert.equal(
      projectPrimaryOnly.blockedRecent[0]?.requestId,
      fixture.blockedRequestId,
    );
    assert.ok(
      projectPrimaryOnly.recentAudit.every(
        (item) => item.project.id === fixture.projectPrimaryId,
      ),
    );
  } finally {
    await cleanupWorkspaceFixture(connection.db, fixture.workspaceId);
  }
});

test("getRequestsCsvExport returns manager-readable rows scoped to the rolling window", async (t) => {
  const connection = await openIntegrationDatabase(t);

  if (!connection) {
    return;
  }

  const suffix = randomUUID().slice(0, 8);
  const fixture = await seedRequestsPageFixture(connection.db, suffix);
  const olderRequestId = `req_requests_older_${suffix}`;
  const olderAttemptId = `attempt_requests_older_${suffix}`;

  try {
    await connection.db.insert(requests).values({
      id: olderRequestId,
      workspaceId: fixture.workspaceId,
      projectId: fixture.projectSecondaryId,
      apiKeyId: `gak_requests_secondary_${suffix}`,
      source: "api",
      mode: "balanced",
      taskType: "general",
      status: "succeeded",
      normalizedRequestJson: {
        stream: false,
        messages: [
          {
            role: "user",
            content: "Do not expose old prompt",
          },
        ],
      },
      requestMetadata: {
        source: "requests-csv-older",
      },
      startedAt: new Date("2026-03-10T09:00:00.000Z"),
      completedAt: new Date("2026-03-10T09:00:02.000Z"),
    });

    await connection.db.insert(requestAttempts).values({
      id: olderAttemptId,
      requestId: olderRequestId,
      workspaceId: fixture.workspaceId,
      projectId: fixture.projectSecondaryId,
      providerAccountId: `provacc_requests_${suffix}`,
      provider: "openai",
      modelId: "gpt-5-mini",
      attemptNumber: 1,
      selectionReason: "Recovered older request inside the 30-day export.",
      status: "succeeded",
      startedAt: new Date("2026-03-10T09:00:00.500Z"),
      completedAt: new Date("2026-03-10T09:00:01.500Z"),
      latencyMs: 640,
      providerRequestId: `provider_older_${suffix}`,
    });

    await connection.db.insert(usageRecords).values({
      id: `usage_requests_older_${suffix}`,
      workspaceId: fixture.workspaceId,
      projectId: fixture.projectSecondaryId,
      requestId: olderRequestId,
      attemptId: olderAttemptId,
      provider: "openai",
      modelId: "gpt-5-mini",
      usageSource: "estimated",
      inputTokens: 40,
      outputTokens: 10,
      totalTokens: 50,
      costTotal: "0.05000000",
      currency: "USD",
      pricingVersion: "catalog_cost_tier_v1",
      recordedAt: new Date("2026-03-10T09:00:01.500Z"),
    });

    await connection.db.insert(auditEvents).values([
      {
        id: `audit_requests_older_routing_${suffix}`,
        workspaceId: fixture.workspaceId,
        projectId: fixture.projectSecondaryId,
        actorType: "api_key",
        actorApiKeyId: `gak_requests_secondary_${suffix}`,
        eventType: "chat.routing.decision",
        entityType: "request",
        entityId: olderRequestId,
        eventPayload: {
          message: "Recovered older request inside the 30-day export.",
          routing_decision: {
            outcome: "selected",
            selectionReasonCode: "best_score_for_mode",
            selectionReasonText:
              "Recovered older request inside the 30-day export.",
            selected: {
              provider: "openai",
              model: "gpt-5-mini",
            },
          },
        },
        createdAt: new Date("2026-03-10T09:00:00.250Z"),
      },
      {
        id: `audit_requests_older_completed_${suffix}`,
        workspaceId: fixture.workspaceId,
        projectId: fixture.projectSecondaryId,
        actorType: "api_key",
        actorApiKeyId: `gak_requests_secondary_${suffix}`,
        eventType: "chat.completions.completed",
        entityType: "request",
        entityId: olderRequestId,
        eventPayload: {
          message: "Older request completed successfully.",
          metadata: {
            mode: "balanced",
            request_status: "succeeded",
            provider: "openai",
            model: "gpt-5-mini",
            latency_ms: 640,
            usage_recorded: true,
            usage_source: "estimated",
            input_tokens: 40,
            output_tokens: 10,
            total_tokens: 50,
            cost_total_usd: 0.05,
            currency: "USD",
            selection_reason_code: "best_score_for_mode",
            selection_reason_text:
              "Recovered older request inside the 30-day export.",
          },
        },
        createdAt: new Date("2026-03-10T09:00:01.750Z"),
      },
    ]);

    const thirtyDayExport = await getRequestsCsvExport(
      {
        workspaceId: fixture.workspaceId,
        range: "30d",
        now: new Date("2026-03-31T12:00:00.000Z"),
      },
      connection.db,
    );
    const sevenDayExport = await getRequestsCsvExport(
      {
        workspaceId: fixture.workspaceId,
        range: "7d",
        now: new Date("2026-03-31T12:00:00.000Z"),
      },
      connection.db,
    );

    assert.equal(thirtyDayExport.window.range, "30d");
    assert.equal(sevenDayExport.window.range, "7d");
    assert.deepEqual(
      thirtyDayExport.rows.map((row) => row.timestamp),
      [
        "2026-03-26T10:02:00.000Z",
        "2026-03-26T10:01:00.000Z",
        "2026-03-26T10:00:00.000Z",
        "2026-03-10T09:00:00.000Z",
      ],
    );
    assert.deepEqual(
      sevenDayExport.rows.map((row) => row.timestamp),
      [
        "2026-03-26T10:02:00.000Z",
        "2026-03-26T10:01:00.000Z",
        "2026-03-26T10:00:00.000Z",
      ],
    );

    const successRow = thirtyDayExport.rows.find(
      (row) => row.timestamp === "2026-03-26T10:00:00.000Z",
    );
    const failedRow = thirtyDayExport.rows.find(
      (row) => row.timestamp === "2026-03-26T10:01:00.000Z",
    );
    const blockedRow = thirtyDayExport.rows.find(
      (row) => row.timestamp === "2026-03-26T10:02:00.000Z",
    );

    assert.deepEqual(Object.keys(thirtyDayExport.rows[0] ?? {}), [
      "timestamp",
      "project",
      "mode",
      "provider",
      "model",
      "status",
      "latency",
      "usage",
      "cost",
      "selectionReason",
      "issueSummary",
    ]);

    assert.ok(successRow);
    assert.equal(successRow?.project, `Requests Primary ${suffix}`);
    assert.equal(successRow?.mode, "Balanced");
    assert.equal(successRow?.provider, "OpenAI");
    assert.equal(successRow?.model, "gpt-5-mini");
    assert.equal(successRow?.status, "Succeeded");
    assert.equal(successRow?.latency, "321 ms");
    assert.equal(successRow?.usage, "165 total tokens");
    assert.equal(successRow?.cost, "$0.42");
    assert.equal(
      successRow?.selectionReason,
      "Selected the best balanced candidate for cost and latency.",
    );
    assert.equal(successRow?.issueSummary, "");

    assert.ok(failedRow);
    assert.equal(failedRow?.status, "Failed");
    assert.equal(
      failedRow?.issueSummary,
      "The provider timed out before completion. (provider_timeout / timeout)",
    );

    assert.ok(blockedRow);
    assert.equal(blockedRow?.provider, "No provider selected");
    assert.equal(blockedRow?.model, "No provider selected");
    assert.equal(blockedRow?.latency, "Not recorded yet");
    assert.equal(blockedRow?.usage, "Not recorded yet");
    assert.equal(blockedRow?.cost, "Not recorded yet");
    assert.equal(blockedRow?.status, "Blocked");
    assert.equal(
      blockedRow?.selectionReason,
      "Blocked because the workspace monthly gateway-recorded budget cap has already been reached.",
    );
    assert.equal(
      blockedRow?.issueSummary,
      "Blocked because the workspace monthly gateway-recorded budget cap has already been reached. (policy_blocked_budget_cap / policy_blocked)",
    );

    const serialized = JSON.stringify(thirtyDayExport);

    assert.ok(!serialized.includes("Do not expose failed prompt"));
    assert.ok(!serialized.includes("Do not expose blocked prompt"));
    assert.ok(!serialized.includes("Do not expose old prompt"));
  } finally {
    await cleanupWorkspaceFixture(connection.db, fixture.workspaceId);
  }
});

test("getAuditCsvExport returns a narrow metadata-only export scoped to the rolling window", async (t) => {
  const connection = await openIntegrationDatabase(t);

  if (!connection) {
    return;
  }

  const suffix = randomUUID().slice(0, 8);
  const fixture = await seedRequestsPageFixture(connection.db, suffix);

  try {
    await connection.db.insert(auditEvents).values({
      id: `audit_workspace_budget_${suffix}`,
      workspaceId: fixture.workspaceId,
      projectId: null,
      actorType: "system",
      eventType: "workspace.budget_cap_updated",
      entityType: "workspace",
      entityId: fixture.workspaceId,
      eventPayload: {
        message: "Set the workspace budget cap to 125 USD.",
        limit_usd: 125,
        debug_payload: {
          prompt: "do not export debug payload",
          secret: "test-provider-hidden-debug-secret",
        },
      },
      createdAt: new Date("2026-03-10T09:30:00.000Z"),
    });

    const thirtyDayExport = await getAuditCsvExport(
      {
        workspaceId: fixture.workspaceId,
        range: "30d",
        now: new Date("2026-03-31T12:00:00.000Z"),
      },
      connection.db,
    );
    const sevenDayExport = await getAuditCsvExport(
      {
        workspaceId: fixture.workspaceId,
        range: "7d",
        now: new Date("2026-03-31T12:00:00.000Z"),
      },
      connection.db,
    );

    assert.equal(thirtyDayExport.window.range, "30d");
    assert.equal(sevenDayExport.window.range, "7d");
    assert.ok(
      thirtyDayExport.rows.some(
        (row) =>
          row.timestamp === "2026-03-10T09:30:00.000Z" &&
          row.eventType === "workspace.budget_cap_updated",
      ),
    );
    assert.ok(
      !sevenDayExport.rows.some(
        (row) =>
          row.timestamp === "2026-03-10T09:30:00.000Z" &&
          row.eventType === "workspace.budget_cap_updated",
      ),
    );
    assert.deepEqual(Object.keys(thirtyDayExport.rows[0] ?? {}), [
      "timestamp",
      "eventType",
      "entityType",
      "entityId",
      "project",
      "actorType",
      "requestStatus",
      "provider",
      "model",
      "error",
      "cost",
      "message",
    ]);

    const routingRow = thirtyDayExport.rows.find(
      (row) =>
        row.eventType === "chat.routing.decision" &&
        row.entityId === fixture.successRequestId,
    );
    const failedRow = thirtyDayExport.rows.find(
      (row) =>
        row.eventType === "chat.completions.failed" &&
        row.entityId === fixture.failedRequestId,
    );
    const projectRow = thirtyDayExport.rows.find(
      (row) => row.eventType === "project.created",
    );
    const workspaceRow = thirtyDayExport.rows.find(
      (row) => row.eventType === "workspace.budget_cap_updated",
    );

    assert.ok(routingRow);
    assert.equal(routingRow?.project, `Requests Primary ${suffix}`);
    assert.equal(routingRow?.actorType, "api_key");
    assert.equal(routingRow?.requestStatus, "");
    assert.equal(routingRow?.provider, "openai");
    assert.equal(routingRow?.model, "gpt-5-mini");
    assert.equal(routingRow?.error, "");
    assert.equal(
      routingRow?.message,
      "Selected the best balanced candidate for cost and latency.",
    );

    assert.ok(failedRow);
    assert.equal(failedRow?.requestStatus, "failed");
    assert.equal(failedRow?.provider, "openai");
    assert.equal(failedRow?.model, "gpt-5.2");
    assert.equal(failedRow?.error, "provider_timeout / timeout");
    assert.equal(failedRow?.cost, "$0.12");

    assert.ok(projectRow);
    assert.equal(projectRow?.project, `Requests Primary ${suffix}`);
    assert.equal(projectRow?.actorType, "system");
    assert.equal(projectRow?.requestStatus, "");
    assert.equal(projectRow?.provider, "");
    assert.equal(projectRow?.model, "");
    assert.equal(projectRow?.error, "");
    assert.equal(projectRow?.cost, "");
    assert.equal(
      projectRow?.message,
      "Created project for unrelated control-plane activity.",
    );

    assert.ok(workspaceRow);
    assert.equal(workspaceRow?.project, "Workspace scope");
    assert.equal(workspaceRow?.actorType, "system");
    assert.equal(workspaceRow?.provider, "");
    assert.equal(workspaceRow?.model, "");
    assert.equal(workspaceRow?.error, "");
    assert.equal(workspaceRow?.cost, "");
    assert.equal(
      workspaceRow?.message,
      "Set the workspace budget cap to 125 USD.",
    );

    const serialized = JSON.stringify(thirtyDayExport);

    assert.ok(!serialized.includes("Do not expose failed prompt"));
    assert.ok(!serialized.includes("Do not expose blocked prompt"));
    assert.ok(!serialized.includes("test-provider-hidden-debug-secret"));
    assert.ok(!serialized.includes("do not export debug payload"));
  } finally {
    await cleanupWorkspaceFixture(connection.db, fixture.workspaceId);
  }
});
