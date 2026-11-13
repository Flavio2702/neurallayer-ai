import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { type TestContext, test } from "node:test";

import { loadDatabaseConfig } from "@neuralayer/config";
import { eq } from "drizzle-orm";

import { createDbConnection } from "./client";
import { MANUAL_REQUEST_FEEDBACK_EVENT_TYPE } from "./manual-request-feedback-service";
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
import { getTrialSummary } from "./trial-summary-service";

const TEST_NOW = new Date("2026-03-30T12:00:00.000Z");

function assertUsd(actual: number, expected: number) {
  assert.ok(Math.abs(actual - expected) < 0.0000001);
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

async function seedTrialSummaryFixture(
  db: ReturnType<typeof createDbConnection>["db"],
  suffix: string,
) {
  const workspaceId = `ws_trial_summary_${suffix}`;
  const projectPrimaryId = `proj_trial_summary_primary_${suffix}`;
  const projectSecondaryId = `proj_trial_summary_secondary_${suffix}`;
  const apiKeyPrimaryId = `gak_trial_summary_primary_${suffix}`;
  const apiKeySecondaryId = `gak_trial_summary_secondary_${suffix}`;
  const openaiAccountId = `provacc_trial_summary_openai_${suffix}`;
  const anthropicAccountId = `provacc_trial_summary_anthropic_${suffix}`;
  const recentSuccessRequestId = `req_trial_summary_success_${suffix}`;
  const recentFailedRequestId = `req_trial_summary_failed_${suffix}`;
  const recentBlockedRequestId = `req_trial_summary_blocked_${suffix}`;
  const recentRunningRequestId = `req_trial_summary_running_${suffix}`;
  const auditOnlySuccessRequestId = `req_trial_summary_audit_only_${suffix}`;
  const outsideWindowRequestId = `req_trial_summary_outside_${suffix}`;

  await db.insert(workspaces).values({
    id: workspaceId,
    name: `Trial Summary Workspace ${suffix}`,
    slug: `trial-summary-workspace-${suffix}`,
    status: "active",
    defaultMode: "balanced",
  });

  await db.insert(projects).values([
    {
      id: projectPrimaryId,
      workspaceId,
      name: `Trial Summary Primary ${suffix}`,
      slug: `trial-summary-primary-${suffix}`,
      status: "active",
      defaultMode: "balanced",
    },
    {
      id: projectSecondaryId,
      workspaceId,
      name: `Trial Summary Secondary ${suffix}`,
      slug: `trial-summary-secondary-${suffix}`,
      status: "active",
      defaultMode: "balanced",
    },
  ]);

  await db.insert(gatewayApiKeys).values([
    {
      id: apiKeyPrimaryId,
      workspaceId,
      projectId: projectPrimaryId,
      name: `Trial Summary Primary Key ${suffix}`,
      keyPrefix: `nl_trial_p_${suffix}`,
      keyHash: `hash_trial_p_${suffix}`,
      status: "active",
    },
    {
      id: apiKeySecondaryId,
      workspaceId,
      projectId: projectSecondaryId,
      name: `Trial Summary Secondary Key ${suffix}`,
      keyPrefix: `nl_trial_s_${suffix}`,
      keyHash: `hash_trial_s_${suffix}`,
      status: "active",
    },
  ]);

  await db.insert(providerAccounts).values([
    {
      id: openaiAccountId,
      workspaceId,
      provider: "openai",
      displayName: `Trial Summary OpenAI ${suffix}`,
      status: "active",
      encryptedCredentials: '{"apiKey":"test-provider-trial-summary-openai"}',
      testStatus: "ready",
    },
    {
      id: anthropicAccountId,
      workspaceId,
      provider: "anthropic",
      displayName: `Trial Summary Anthropic ${suffix}`,
      status: "active",
      encryptedCredentials:
        '{"apiKey":"test-provider-trial-summary-anthropic"}',
      testStatus: "ready",
    },
  ]);

  await db.insert(requests).values([
    {
      id: recentSuccessRequestId,
      workspaceId,
      projectId: projectPrimaryId,
      apiKeyId: apiKeyPrimaryId,
      source: "api",
      mode: "balanced",
      taskType: "general",
      status: "succeeded",
      normalizedRequestJson: {
        stream: false,
        messages: [
          {
            role: "user",
            content: "Do not expose recent success prompt",
          },
        ],
      },
      startedAt: new Date("2026-03-29T09:00:00.000Z"),
      completedAt: new Date("2026-03-29T09:00:03.000Z"),
    },
    {
      id: recentFailedRequestId,
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
            content: "Do not expose recent failed prompt",
          },
        ],
      },
      startedAt: new Date("2026-03-28T10:00:00.000Z"),
      completedAt: new Date("2026-03-28T10:00:04.000Z"),
    },
    {
      id: recentBlockedRequestId,
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
            content: "Do not expose recent blocked prompt",
          },
        ],
      },
      startedAt: new Date("2026-03-27T11:00:00.000Z"),
      completedAt: null,
    },
    {
      id: recentRunningRequestId,
      workspaceId,
      projectId: projectSecondaryId,
      apiKeyId: apiKeySecondaryId,
      source: "api",
      mode: "balanced",
      taskType: "general",
      status: "running",
      normalizedRequestJson: {
        stream: false,
        messages: [
          {
            role: "user",
            content: "Do not expose recent running prompt",
          },
        ],
      },
      startedAt: new Date("2026-03-30T08:00:00.000Z"),
      completedAt: null,
    },
    {
      id: auditOnlySuccessRequestId,
      workspaceId,
      projectId: projectPrimaryId,
      apiKeyId: apiKeyPrimaryId,
      source: "api",
      mode: "budget",
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
      startedAt: new Date("2026-03-05T14:00:00.000Z"),
      completedAt: new Date("2026-03-05T14:00:02.000Z"),
    },
    {
      id: outsideWindowRequestId,
      workspaceId,
      projectId: projectPrimaryId,
      apiKeyId: apiKeyPrimaryId,
      source: "api",
      mode: "balanced",
      taskType: "general",
      status: "succeeded",
      normalizedRequestJson: {
        stream: false,
        messages: [
          {
            role: "user",
            content: "Do not expose outside-window prompt",
          },
        ],
      },
      startedAt: new Date("2026-02-25T09:00:00.000Z"),
      completedAt: new Date("2026-02-25T09:00:02.000Z"),
    },
  ]);

  await db.insert(requestAttempts).values([
    {
      id: `attempt_trial_summary_success_${suffix}`,
      requestId: recentSuccessRequestId,
      workspaceId,
      projectId: projectPrimaryId,
      providerAccountId: openaiAccountId,
      provider: "openai",
      modelId: "gpt-5-mini",
      attemptNumber: 1,
      selectionReason: "Selected the best balanced candidate for trial value.",
      status: "succeeded",
      startedAt: new Date("2026-03-29T09:00:01.000Z"),
      completedAt: new Date("2026-03-29T09:00:02.000Z"),
      latencyMs: 321,
      providerRequestId: `provider_trial_success_${suffix}`,
    },
    {
      id: `attempt_trial_summary_failed_${suffix}`,
      requestId: recentFailedRequestId,
      workspaceId,
      projectId: projectSecondaryId,
      providerAccountId: openaiAccountId,
      provider: "openai",
      modelId: "gpt-5.2",
      attemptNumber: 1,
      selectionReason: "Chose the highest quality candidate still available.",
      status: "failed",
      startedAt: new Date("2026-03-28T10:00:01.000Z"),
      completedAt: new Date("2026-03-28T10:00:03.000Z"),
      latencyMs: 987,
      errorType: "timeout",
      errorCode: "provider_timeout",
      errorMessage: "The provider timed out before completion.",
      providerRequestId: `provider_trial_failed_${suffix}`,
    },
    {
      id: `attempt_trial_summary_running_${suffix}`,
      requestId: recentRunningRequestId,
      workspaceId,
      projectId: projectSecondaryId,
      providerAccountId: anthropicAccountId,
      provider: "anthropic",
      modelId: "claude-3-5-haiku-20241022",
      attemptNumber: 1,
      selectionReason: "Selected the fastest available anthropic candidate.",
      status: "running",
      startedAt: new Date("2026-03-30T08:00:01.000Z"),
      completedAt: null,
      latencyMs: null,
      providerRequestId: `provider_trial_running_${suffix}`,
    },
    {
      id: `attempt_trial_summary_outside_${suffix}`,
      requestId: outsideWindowRequestId,
      workspaceId,
      projectId: projectPrimaryId,
      providerAccountId: openaiAccountId,
      provider: "openai",
      modelId: "gpt-5-mini",
      attemptNumber: 1,
      selectionReason:
        "Selected the best balanced candidate before the summary window.",
      status: "succeeded",
      startedAt: new Date("2026-02-25T09:00:01.000Z"),
      completedAt: new Date("2026-02-25T09:00:02.000Z"),
      latencyMs: 250,
      providerRequestId: `provider_trial_outside_${suffix}`,
    },
  ]);

  await db.insert(usageRecords).values([
    {
      id: `usage_trial_summary_success_${suffix}`,
      workspaceId,
      projectId: projectPrimaryId,
      requestId: recentSuccessRequestId,
      attemptId: `attempt_trial_summary_success_${suffix}`,
      provider: "openai",
      modelId: "gpt-5-mini",
      usageSource: "estimated",
      inputTokens: 120,
      outputTokens: 45,
      totalTokens: 165,
      costTotal: "0.42000000",
      currency: "USD",
      pricingVersion: "catalog_cost_tier_v1",
      recordedAt: new Date("2026-03-29T09:00:02.000Z"),
    },
    {
      id: `usage_trial_summary_outside_${suffix}`,
      workspaceId,
      projectId: projectPrimaryId,
      requestId: outsideWindowRequestId,
      attemptId: `attempt_trial_summary_outside_${suffix}`,
      provider: "openai",
      modelId: "gpt-5-mini",
      usageSource: "estimated",
      inputTokens: 220,
      outputTokens: 80,
      totalTokens: 300,
      costTotal: "0.77000000",
      currency: "USD",
      pricingVersion: "catalog_cost_tier_v1",
      recordedAt: new Date("2026-02-25T09:00:02.000Z"),
    },
  ]);

  await db.insert(auditEvents).values([
    {
      id: `audit_trial_summary_success_routing_${suffix}`,
      workspaceId,
      projectId: projectPrimaryId,
      actorType: "api_key",
      actorApiKeyId: apiKeyPrimaryId,
      eventType: "chat.routing.decision",
      entityType: "request",
      entityId: recentSuccessRequestId,
      eventPayload: {
        message: "Selected the best balanced candidate for trial value.",
        routing_decision: {
          outcome: "selected",
          selectionReasonCode: "best_score_for_mode",
          selectionReasonText:
            "Selected the best balanced candidate for trial value.",
          selected: {
            provider: "openai",
            model: "gpt-5-mini",
          },
        },
      },
      createdAt: new Date("2026-03-29T09:00:00.500Z"),
    },
    {
      id: `audit_trial_summary_success_completed_${suffix}`,
      workspaceId,
      projectId: projectPrimaryId,
      actorType: "api_key",
      actorApiKeyId: apiKeyPrimaryId,
      eventType: "chat.completions.completed",
      entityType: "request",
      entityId: recentSuccessRequestId,
      eventPayload: {
        message: "Request completed successfully for the trial summary.",
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
            "Selected the best balanced candidate for trial value.",
        },
      },
      createdAt: new Date("2026-03-29T09:00:02.500Z"),
    },
    {
      id: `audit_trial_summary_failed_routing_${suffix}`,
      workspaceId,
      projectId: projectSecondaryId,
      actorType: "api_key",
      actorApiKeyId: apiKeySecondaryId,
      eventType: "chat.routing.decision",
      entityType: "request",
      entityId: recentFailedRequestId,
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
      createdAt: new Date("2026-03-28T10:00:00.500Z"),
    },
    {
      id: `audit_trial_summary_failed_failed_${suffix}`,
      workspaceId,
      projectId: projectSecondaryId,
      actorType: "api_key",
      actorApiKeyId: apiKeySecondaryId,
      eventType: "chat.completions.failed",
      entityType: "request",
      entityId: recentFailedRequestId,
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
      createdAt: new Date("2026-03-28T10:00:03.500Z"),
    },
    {
      id: `audit_trial_summary_blocked_routing_${suffix}`,
      workspaceId,
      projectId: projectPrimaryId,
      actorType: "api_key",
      actorApiKeyId: apiKeyPrimaryId,
      eventType: "chat.routing.decision",
      entityType: "request",
      entityId: recentBlockedRequestId,
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
      createdAt: new Date("2026-03-27T11:00:00.500Z"),
    },
    {
      id: `audit_trial_summary_blocked_blocked_${suffix}`,
      workspaceId,
      projectId: projectPrimaryId,
      actorType: "api_key",
      actorApiKeyId: apiKeyPrimaryId,
      eventType: "chat.completions.blocked",
      entityType: "request",
      entityId: recentBlockedRequestId,
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
          cost_total_usd: 0,
          currency: "USD",
        },
      },
      createdAt: new Date("2026-03-27T11:00:01.000Z"),
    },
    {
      id: `audit_trial_summary_blocked_failed_noise_${suffix}`,
      workspaceId,
      projectId: projectPrimaryId,
      actorType: "api_key",
      actorApiKeyId: apiKeyPrimaryId,
      eventType: "chat.completions.failed",
      entityType: "request",
      entityId: recentBlockedRequestId,
      eventPayload: {
        message: "Internal follow-up noise that should not override the block.",
        metadata: {
          mode: "budget",
          request_status: "failed",
          error_type: "internal_error",
          error_code: "provider_execution_threw",
        },
      },
      createdAt: new Date("2026-03-27T11:00:02.000Z"),
    },
    {
      id: `audit_trial_summary_running_routing_${suffix}`,
      workspaceId,
      projectId: projectSecondaryId,
      actorType: "api_key",
      actorApiKeyId: apiKeySecondaryId,
      eventType: "chat.routing.decision",
      entityType: "request",
      entityId: recentRunningRequestId,
      eventPayload: {
        message: "Selected the fastest available anthropic candidate.",
        routing_decision: {
          outcome: "selected",
          selectionReasonCode: "best_latency_candidate",
          selectionReasonText:
            "Selected the fastest available anthropic candidate.",
          selected: {
            provider: "anthropic",
            model: "claude-3-5-haiku-20241022",
          },
        },
      },
      createdAt: new Date("2026-03-30T08:00:00.500Z"),
    },
    {
      id: `audit_trial_summary_audit_only_completed_${suffix}`,
      workspaceId,
      projectId: projectPrimaryId,
      actorType: "api_key",
      actorApiKeyId: apiKeyPrimaryId,
      eventType: "chat.completions.completed",
      entityType: "request",
      entityId: auditOnlySuccessRequestId,
      eventPayload: {
        message: "Completed via runtime audit fallback for the trial.",
        metadata: {
          mode: "budget",
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
      createdAt: new Date("2026-03-05T14:00:02.500Z"),
    },
    {
      id: `audit_trial_summary_outside_completed_${suffix}`,
      workspaceId,
      projectId: projectPrimaryId,
      actorType: "api_key",
      actorApiKeyId: apiKeyPrimaryId,
      eventType: "chat.completions.completed",
      entityType: "request",
      entityId: outsideWindowRequestId,
      eventPayload: {
        message: "Completed before the rolling 30 day summary window.",
        metadata: {
          mode: "balanced",
          request_status: "succeeded",
          provider: "openai",
          model: "gpt-5-mini",
          cost_total_usd: 0.77,
          currency: "USD",
        },
      },
      createdAt: new Date("2026-02-25T09:00:02.500Z"),
    },
  ]);

  return {
    workspaceId,
    requestIds: {
      recentSuccessRequestId,
      recentFailedRequestId,
      recentBlockedRequestId,
      recentRunningRequestId,
      auditOnlySuccessRequestId,
      outsideWindowRequestId,
    },
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

test("getTrialSummary returns rolling 7d totals, splits, and runtime-only highlights", async (t) => {
  const connection = await openIntegrationDatabase(t);

  if (!connection) {
    return;
  }

  const suffix = randomUUID().slice(0, 8);
  const fixture = await seedTrialSummaryFixture(connection.db, suffix);

  try {
    const summary = await getTrialSummary(
      {
        workspaceId: fixture.workspaceId,
        range: "7d",
        now: TEST_NOW,
      },
      connection.db,
    );

    assert.deepEqual(summary.window, {
      range: "7d",
      start: "2026-03-23T12:00:00.000Z",
      end: "2026-03-30T12:00:00.000Z",
    });
    assert.deepEqual(summary.totals, {
      requestCount: 4,
      succeededCount: 1,
      blockedCount: 1,
      failedCount: 1,
      runningCount: 1,
      totalCostUsd: 0.54,
    });
    assert.deepEqual(
      summary.providerBreakdown.map((item) => item.provider),
      ["openai", "anthropic", "not_routed"],
    );
    assert.deepEqual(
      summary.providerBreakdown.map((item) => [
        item.provider,
        item.requestCount,
        item.succeededCount,
        item.blockedCount,
        item.failedCount,
        item.runningCount,
      ]),
      [
        ["openai", 2, 1, 0, 1, 0],
        ["anthropic", 1, 0, 0, 0, 1],
        ["not_routed", 1, 0, 1, 0, 0],
      ],
    );
    assertUsd(summary.providerBreakdown[0]?.totalCostUsd ?? 0, 0.54);
    assertUsd(summary.providerBreakdown[1]?.totalCostUsd ?? 0, 0);
    assertUsd(summary.providerBreakdown[2]?.totalCostUsd ?? 0, 0);
    assert.deepEqual(
      summary.modeBreakdown.map((item) => item.mode),
      ["max_quality", "balanced", "budget"],
    );
    assert.deepEqual(
      summary.modeBreakdown.map((item) => [
        item.mode,
        item.requestCount,
        item.succeededCount,
        item.blockedCount,
        item.failedCount,
        item.runningCount,
      ]),
      [
        ["max_quality", 1, 0, 0, 1, 0],
        ["balanced", 2, 1, 0, 0, 1],
        ["budget", 1, 0, 1, 0, 0],
      ],
    );
    assertUsd(summary.modeBreakdown[0]?.totalCostUsd ?? 0, 0.12);
    assertUsd(summary.modeBreakdown[1]?.totalCostUsd ?? 0, 0.42);
    assertUsd(summary.modeBreakdown[2]?.totalCostUsd ?? 0, 0);

    assert.deepEqual(
      summary.highlights.map((item) => item.requestId),
      [
        fixture.requestIds.recentSuccessRequestId,
        fixture.requestIds.recentFailedRequestId,
        fixture.requestIds.recentBlockedRequestId,
      ],
    );
    assert.deepEqual(
      summary.highlights.map((item) => item.eventType),
      [
        "chat.completions.completed",
        "chat.completions.failed",
        "chat.completions.blocked",
      ],
    );
    assert.equal(summary.highlights[1]?.errorCode, "provider_timeout");
    assert.equal(summary.highlights[2]?.errorCode, "policy_blocked_budget_cap");
    assert.equal(summary.highlights[2]?.provider, null);

    const serialized = JSON.stringify(summary);

    assert.ok(!serialized.includes("Do not expose recent success prompt"));
    assert.ok(!serialized.includes("Do not expose recent failed prompt"));
    assert.ok(!serialized.includes("Do not expose recent blocked prompt"));
    assert.ok(!serialized.includes("Do not expose recent running prompt"));
  } finally {
    await cleanupWorkspaceFixture(connection.db, fixture.workspaceId);
  }
});

test("getTrialSummary expands to 30d and backfills audit-only request value from runtime audit metadata", async (t) => {
  const connection = await openIntegrationDatabase(t);

  if (!connection) {
    return;
  }

  const suffix = randomUUID().slice(0, 8);
  const fixture = await seedTrialSummaryFixture(connection.db, suffix);

  try {
    const summary = await getTrialSummary(
      {
        workspaceId: fixture.workspaceId,
        range: "30d",
        now: TEST_NOW,
      },
      connection.db,
    );

    assert.deepEqual(summary.window, {
      range: "30d",
      start: "2026-02-28T12:00:00.000Z",
      end: "2026-03-30T12:00:00.000Z",
    });
    assert.equal(summary.totals.requestCount, 5);
    assert.equal(summary.totals.succeededCount, 2);
    assert.equal(summary.totals.blockedCount, 1);
    assert.equal(summary.totals.failedCount, 1);
    assert.equal(summary.totals.runningCount, 1);
    assertUsd(summary.totals.totalCostUsd, 0.85);
    assert.ok(
      summary.highlights.every(
        (item) => item.requestId !== fixture.requestIds.outsideWindowRequestId,
      ),
    );

    const anthropicBucket = summary.providerBreakdown.find(
      (item) => item.provider === "anthropic",
    );
    const budgetMode = summary.modeBreakdown.find(
      (item) => item.mode === "budget",
    );
    const auditOnlyHighlight = summary.highlights.find(
      (item) => item.requestId === fixture.requestIds.auditOnlySuccessRequestId,
    );

    assert.ok(anthropicBucket);
    assert.equal(anthropicBucket?.requestCount, 2);
    assert.equal(anthropicBucket?.succeededCount, 1);
    assert.equal(anthropicBucket?.runningCount, 1);
    assertUsd(anthropicBucket?.totalCostUsd ?? 0, 0.31);

    assert.ok(budgetMode);
    assert.equal(budgetMode?.requestCount, 2);
    assert.equal(budgetMode?.succeededCount, 1);
    assert.equal(budgetMode?.blockedCount, 1);
    assertUsd(budgetMode?.totalCostUsd ?? 0, 0.31);

    assert.ok(auditOnlyHighlight);
    assert.equal(auditOnlyHighlight?.eventType, "chat.completions.completed");
    assert.equal(auditOnlyHighlight?.provider, "anthropic");
    assert.equal(auditOnlyHighlight?.model, "claude-3-5-haiku-20241022");
    assert.equal(
      auditOnlyHighlight?.message,
      "Completed via runtime audit fallback for the trial.",
    );
    assertUsd(auditOnlyHighlight?.costTotalUsd ?? 0, 0.31);
  } finally {
    await cleanupWorkspaceFixture(connection.db, fixture.workspaceId);
  }
});

test("getTrialSummary keeps only the latest five runtime highlights and ignores request-level control-plane noise", async (t) => {
  const connection = await openIntegrationDatabase(t);

  if (!connection) {
    return;
  }

  const suffix = randomUUID().slice(0, 8);
  const fixture = await seedTrialSummaryFixture(connection.db, suffix);
  const projectPrimaryId = `proj_trial_summary_primary_${suffix}`;
  const projectSecondaryId = `proj_trial_summary_secondary_${suffix}`;
  const apiKeyPrimaryId = `gak_trial_summary_primary_${suffix}`;
  const apiKeySecondaryId = `gak_trial_summary_secondary_${suffix}`;
  const firstExtraRequestId = `req_trial_summary_extra_one_${suffix}`;
  const secondExtraRequestId = `req_trial_summary_extra_two_${suffix}`;

  try {
    await connection.db.insert(requests).values([
      {
        id: firstExtraRequestId,
        workspaceId: fixture.workspaceId,
        projectId: projectPrimaryId,
        apiKeyId: apiKeyPrimaryId,
        source: "api",
        mode: "balanced",
        taskType: "general",
        status: "succeeded",
        normalizedRequestJson: {
          stream: false,
          messages: [
            {
              role: "user",
              content: "Do not expose extra highlight one prompt",
            },
          ],
        },
        startedAt: new Date("2026-03-30T10:00:00.000Z"),
        completedAt: new Date("2026-03-30T10:00:02.000Z"),
      },
      {
        id: secondExtraRequestId,
        workspaceId: fixture.workspaceId,
        projectId: projectSecondaryId,
        apiKeyId: apiKeySecondaryId,
        source: "api",
        mode: "max_quality",
        taskType: "general",
        status: "succeeded",
        normalizedRequestJson: {
          stream: false,
          messages: [
            {
              role: "user",
              content: "Do not expose extra highlight two prompt",
            },
          ],
        },
        startedAt: new Date("2026-03-30T09:30:00.000Z"),
        completedAt: new Date("2026-03-30T09:30:02.000Z"),
      },
    ]);

    await connection.db.insert(auditEvents).values([
      {
        id: `audit_trial_summary_extra_one_completed_${suffix}`,
        workspaceId: fixture.workspaceId,
        projectId: projectPrimaryId,
        actorType: "api_key",
        actorApiKeyId: apiKeyPrimaryId,
        eventType: "chat.completions.completed",
        entityType: "request",
        entityId: firstExtraRequestId,
        eventPayload: {
          message: "Extra highlight one completed successfully.",
          metadata: {
            mode: "balanced",
            request_status: "succeeded",
            provider: "openai",
            model: "gpt-5-mini",
            latency_ms: 210,
            usage_recorded: true,
            usage_source: "estimated",
            input_tokens: 35,
            output_tokens: 10,
            total_tokens: 45,
            cost_total_usd: 0.07,
            currency: "USD",
          },
        },
        createdAt: new Date("2026-03-30T10:00:02.500Z"),
      },
      {
        id: `audit_trial_summary_extra_two_completed_${suffix}`,
        workspaceId: fixture.workspaceId,
        projectId: projectSecondaryId,
        actorType: "api_key",
        actorApiKeyId: apiKeySecondaryId,
        eventType: "chat.completions.completed",
        entityType: "request",
        entityId: secondExtraRequestId,
        eventPayload: {
          message: "Extra highlight two completed successfully.",
          metadata: {
            mode: "max_quality",
            request_status: "succeeded",
            provider: "anthropic",
            model: "claude-3-5-haiku-20241022",
            latency_ms: 245,
            usage_recorded: true,
            usage_source: "estimated",
            input_tokens: 55,
            output_tokens: 18,
            total_tokens: 73,
            cost_total_usd: 0.11,
            currency: "USD",
          },
        },
        createdAt: new Date("2026-03-30T09:30:02.500Z"),
      },
      {
        id: `audit_trial_summary_feedback_noise_${suffix}`,
        workspaceId: fixture.workspaceId,
        projectId: projectPrimaryId,
        actorType: "system",
        eventType: MANUAL_REQUEST_FEEDBACK_EVENT_TYPE,
        entityType: "request",
        entityId: fixture.requestIds.recentSuccessRequestId,
        eventPayload: {
          message: "Recorded manual request feedback: useful.",
          feedback: {
            value: "useful",
          },
          metadata: {
            source: "admin_surface_manual",
          },
        },
        createdAt: new Date("2026-03-30T11:00:00.000Z"),
      },
    ]);

    const summary = await getTrialSummary(
      {
        workspaceId: fixture.workspaceId,
        range: "30d",
        now: TEST_NOW,
      },
      connection.db,
    );

    assert.equal(summary.highlights.length, 5);
    assert.deepEqual(
      summary.highlights.map((item) => item.requestId),
      [
        firstExtraRequestId,
        secondExtraRequestId,
        fixture.requestIds.recentSuccessRequestId,
        fixture.requestIds.recentFailedRequestId,
        fixture.requestIds.recentBlockedRequestId,
      ],
    );
    assert.ok(
      summary.highlights.every((item) =>
        [
          "chat.completions.completed",
          "chat.completions.failed",
          "chat.completions.blocked",
        ].includes(item.eventType),
      ),
    );
    assert.ok(
      summary.highlights.every(
        (item, index, items) =>
          index === 0 || items[index - 1]!.timestamp >= item.timestamp,
      ),
    );
    assert.equal(
      summary.highlights.some(
        (item) =>
          item.requestId === fixture.requestIds.auditOnlySuccessRequestId,
      ),
      false,
    );

    const serialized = JSON.stringify(summary);

    assert.ok(!serialized.includes("request.feedback_recorded"));
    assert.ok(!serialized.includes("Do not expose extra highlight one prompt"));
    assert.ok(!serialized.includes("Do not expose extra highlight two prompt"));
  } finally {
    await cleanupWorkspaceFixture(connection.db, fixture.workspaceId);
  }
});

test("getTrialSummary returns an empty shape and the default rolling range when no requests fall inside the window", async (t) => {
  const connection = await openIntegrationDatabase(t);

  if (!connection) {
    return;
  }

  const workspaceId = `ws_trial_summary_empty_${randomUUID().slice(0, 8)}`;

  try {
    await connection.db.insert(workspaces).values({
      id: workspaceId,
      name: "Trial Summary Empty Workspace",
      slug: "trial-summary-empty-workspace",
      status: "active",
      defaultMode: "balanced",
    });

    const summary = await getTrialSummary(
      {
        workspaceId,
        now: TEST_NOW,
      },
      connection.db,
    );

    assert.deepEqual(summary.window, {
      range: "30d",
      start: "2026-02-28T12:00:00.000Z",
      end: "2026-03-30T12:00:00.000Z",
    });
    assert.deepEqual(summary.totals, {
      requestCount: 0,
      succeededCount: 0,
      blockedCount: 0,
      failedCount: 0,
      runningCount: 0,
      totalCostUsd: 0,
    });
    assert.deepEqual(summary.providerBreakdown, []);
    assert.deepEqual(summary.modeBreakdown, []);
    assert.deepEqual(summary.highlights, []);
  } finally {
    await connection.db
      .delete(workspaces)
      .where(eq(workspaces.id, workspaceId));
  }
});
