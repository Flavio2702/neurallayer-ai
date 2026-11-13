#!/usr/bin/env node

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  "@neuralayer/admin",
];

const REQUESTS_CSV_HEADER =
  "Timestamp,Project,Mode,Provider,Model,Status,Latency,Usage,Cost,Selection reason,Issue summary";
const AUDIT_CSV_HEADER =
  "Timestamp,Event type,Entity type,Entity id,Project,Actor type,Request status,Provider,Model,Error,Cost,Message";
const FEEDBACK_NOTE = "Manager marked this request as useful for the pilot.";

const PROMPT_MARKERS = {
  recentSuccess: "DO NOT LEAK REQUEST BODY: recent success marker",
  recentFailed: "DO NOT LEAK REQUEST BODY: recent failed marker",
  recentBlocked: "DO NOT LEAK REQUEST BODY: recent blocked marker",
  recentRunning: "DO NOT LEAK REQUEST BODY: recent running marker",
  auditOnlySuccess: "DO NOT LEAK REQUEST BODY: audit-only marker",
  outsideWindow: "DO NOT LEAK REQUEST BODY: outside-window marker",
};

const logStep = createSmokeLogger("admin:smoke:trial-summary");

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

function addSeconds(date, seconds) {
  return new Date(date.getTime() + seconds * 1000);
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function daysAgo(baseDate, days, hour, minute = 0, second = 0) {
  const date = new Date(baseDate);
  date.setUTCDate(date.getUTCDate() - days);
  date.setUTCHours(hour, minute, second, 0);
  return date;
}

function countCsvLines(csvText) {
  return csvText.length === 0 ? 0 : csvText.split(/\r?\n/).length;
}

function getRequestAnchorId(requestId) {
  return `request-${requestId}`;
}

function buildFilenamePattern(prefix, workspaceSlug, range) {
  return new RegExp(
    `attachment;\\s*filename="${prefix}-${workspaceSlug}-${range}-\\d{4}-\\d{2}-\\d{2}\\.csv"`,
  );
}

async function createSmokeFixture(input) {
  const dbModule = loadDbModule();
  const configModule = loadConfigModule();
  const {
    auditEvents,
    createDbConnection,
    gatewayApiKeys,
    projects,
    providerAccounts,
    requestAttempts,
    requests,
    usageRecords,
    workspaces,
  } = dbModule;
  const {
    database: { url },
  } = configModule.loadDatabaseConfig();
  const { db, queryClient } = createDbConnection(url);

  const workspaceId = `ws_admin_smoke_trial_summary_${input.smokeId}`;
  const workspaceSlug = `admin-smoke-trial-summary-${input.smokeId}`;
  const workspaceName = `Admin Smoke Trial Summary ${input.smokeId}`;
  const projectPrimaryId = `proj_admin_smoke_trial_summary_primary_${input.smokeId}`;
  const projectSecondaryId = `proj_admin_smoke_trial_summary_secondary_${input.smokeId}`;
  const apiKeyPrimaryId = `gak_admin_smoke_trial_summary_primary_${input.smokeId}`;
  const apiKeySecondaryId = `gak_admin_smoke_trial_summary_secondary_${input.smokeId}`;
  const openaiAccountId = `provacc_admin_smoke_trial_summary_openai_${input.smokeId}`;
  const anthropicAccountId = `provacc_admin_smoke_trial_summary_anthropic_${input.smokeId}`;
  const requestIds = {
    recentSuccess: `req_admin_smoke_trial_summary_success_${input.smokeId}`,
    recentFailed: `req_admin_smoke_trial_summary_failed_${input.smokeId}`,
    recentBlocked: `req_admin_smoke_trial_summary_blocked_${input.smokeId}`,
    recentRunning: `req_admin_smoke_trial_summary_running_${input.smokeId}`,
    auditOnlySuccess: `req_admin_smoke_trial_summary_audit_only_${input.smokeId}`,
    outsideWindow: `req_admin_smoke_trial_summary_outside_${input.smokeId}`,
  };
  const projectNames = {
    primary: `Trial Summary Primary ${input.smokeId}`,
    secondary: `Trial Summary Secondary ${input.smokeId}`,
  };
  const projectSlugs = {
    primary: `trial-summary-primary-${input.smokeId}`,
    secondary: `trial-summary-secondary-${input.smokeId}`,
  };
  const providerSecrets = {
    openai: `test-provider-trial-summary-openai-${input.smokeId}`,
    anthropic: `test-provider-trial-summary-anthropic-${input.smokeId}`,
  };
  const now = new Date();
  const timestamps = {
    recentSuccessStart: daysAgo(now, 1, 9, 0, 0),
    recentFailedStart: daysAgo(now, 2, 10, 0, 0),
    recentBlockedStart: daysAgo(now, 3, 11, 0, 0),
    recentRunningStart: daysAgo(now, 0, 8, 0, 0),
    auditOnlyStart: daysAgo(now, 10, 14, 0, 0),
    outsideWindowStart: daysAgo(now, 40, 9, 0, 0),
  };

  await db.insert(workspaces).values({
    id: workspaceId,
    name: workspaceName,
    slug: workspaceSlug,
    status: "active",
    defaultMode: "balanced",
    metadata: {
      smokeFixture: "admin_trial_summary",
      smokeId: input.smokeId,
    },
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(projects).values([
    {
      id: projectPrimaryId,
      workspaceId,
      name: projectNames.primary,
      slug: projectSlugs.primary,
      status: "active",
      defaultMode: "balanced",
      metadata: {
        smokeFixture: "admin_trial_summary",
        projectRole: "primary",
      },
      createdAt: now,
      updatedAt: now,
    },
    {
      id: projectSecondaryId,
      workspaceId,
      name: projectNames.secondary,
      slug: projectSlugs.secondary,
      status: "active",
      defaultMode: "balanced",
      metadata: {
        smokeFixture: "admin_trial_summary",
        projectRole: "secondary",
      },
      createdAt: now,
      updatedAt: now,
    },
  ]);

  await db.insert(gatewayApiKeys).values([
    {
      id: apiKeyPrimaryId,
      workspaceId,
      projectId: projectPrimaryId,
      name: `Trial Summary Primary Key ${input.smokeId}`,
      keyPrefix: `nl_trial_p_${input.smokeId}`,
      keyHash: `hash_trial_p_${input.smokeId}`,
      status: "active",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: apiKeySecondaryId,
      workspaceId,
      projectId: projectSecondaryId,
      name: `Trial Summary Secondary Key ${input.smokeId}`,
      keyPrefix: `nl_trial_s_${input.smokeId}`,
      keyHash: `hash_trial_s_${input.smokeId}`,
      status: "active",
      createdAt: now,
      updatedAt: now,
    },
  ]);

  await db.insert(providerAccounts).values([
    {
      id: openaiAccountId,
      workspaceId,
      provider: "openai",
      displayName: `Trial Summary OpenAI ${input.smokeId}`,
      status: "active",
      encryptedCredentials: JSON.stringify({ apiKey: providerSecrets.openai }),
      testStatus: "ready",
      metadata: {
        smokeFixture: "admin_trial_summary",
      },
      createdAt: now,
      updatedAt: now,
    },
    {
      id: anthropicAccountId,
      workspaceId,
      provider: "anthropic",
      displayName: `Trial Summary Anthropic ${input.smokeId}`,
      status: "active",
      encryptedCredentials: JSON.stringify({
        apiKey: providerSecrets.anthropic,
      }),
      testStatus: "ready",
      metadata: {
        smokeFixture: "admin_trial_summary",
      },
      createdAt: now,
      updatedAt: now,
    },
  ]);

  await db.insert(requests).values([
    {
      id: requestIds.recentSuccess,
      workspaceId,
      projectId: projectPrimaryId,
      apiKeyId: apiKeyPrimaryId,
      source: "api",
      mode: "balanced",
      taskType: "general",
      status: "succeeded",
      normalizedRequestJson: {
        stream: false,
        messages: [{ role: "user", content: PROMPT_MARKERS.recentSuccess }],
      },
      startedAt: timestamps.recentSuccessStart,
      completedAt: addSeconds(timestamps.recentSuccessStart, 3),
      createdAt: timestamps.recentSuccessStart,
      updatedAt: addSeconds(timestamps.recentSuccessStart, 3),
    },
    {
      id: requestIds.recentFailed,
      workspaceId,
      projectId: projectSecondaryId,
      apiKeyId: apiKeySecondaryId,
      source: "api",
      mode: "max_quality",
      taskType: "general",
      status: "running",
      normalizedRequestJson: {
        stream: false,
        messages: [{ role: "user", content: PROMPT_MARKERS.recentFailed }],
      },
      startedAt: timestamps.recentFailedStart,
      completedAt: addSeconds(timestamps.recentFailedStart, 4),
      createdAt: timestamps.recentFailedStart,
      updatedAt: addSeconds(timestamps.recentFailedStart, 4),
    },
    {
      id: requestIds.recentBlocked,
      workspaceId,
      projectId: projectPrimaryId,
      apiKeyId: apiKeyPrimaryId,
      source: "api",
      mode: "budget",
      taskType: "general",
      status: "running",
      normalizedRequestJson: {
        stream: false,
        messages: [{ role: "user", content: PROMPT_MARKERS.recentBlocked }],
      },
      startedAt: timestamps.recentBlockedStart,
      completedAt: null,
      createdAt: timestamps.recentBlockedStart,
      updatedAt: timestamps.recentBlockedStart,
    },
    {
      id: requestIds.recentRunning,
      workspaceId,
      projectId: projectSecondaryId,
      apiKeyId: apiKeySecondaryId,
      source: "api",
      mode: "balanced",
      taskType: "general",
      status: "running",
      normalizedRequestJson: {
        stream: false,
        messages: [{ role: "user", content: PROMPT_MARKERS.recentRunning }],
      },
      startedAt: timestamps.recentRunningStart,
      completedAt: null,
      createdAt: timestamps.recentRunningStart,
      updatedAt: timestamps.recentRunningStart,
    },
    {
      id: requestIds.auditOnlySuccess,
      workspaceId,
      projectId: projectPrimaryId,
      apiKeyId: apiKeyPrimaryId,
      source: "api",
      mode: "budget",
      taskType: "general",
      status: "succeeded",
      normalizedRequestJson: {
        stream: false,
        messages: [{ role: "user", content: PROMPT_MARKERS.auditOnlySuccess }],
      },
      startedAt: timestamps.auditOnlyStart,
      completedAt: addSeconds(timestamps.auditOnlyStart, 2),
      createdAt: timestamps.auditOnlyStart,
      updatedAt: addSeconds(timestamps.auditOnlyStart, 2),
    },
    {
      id: requestIds.outsideWindow,
      workspaceId,
      projectId: projectPrimaryId,
      apiKeyId: apiKeyPrimaryId,
      source: "api",
      mode: "balanced",
      taskType: "general",
      status: "succeeded",
      normalizedRequestJson: {
        stream: false,
        messages: [{ role: "user", content: PROMPT_MARKERS.outsideWindow }],
      },
      startedAt: timestamps.outsideWindowStart,
      completedAt: addSeconds(timestamps.outsideWindowStart, 2),
      createdAt: timestamps.outsideWindowStart,
      updatedAt: addSeconds(timestamps.outsideWindowStart, 2),
    },
  ]);

  await db.insert(requestAttempts).values([
    {
      id: `attempt_admin_smoke_trial_summary_success_${input.smokeId}`,
      requestId: requestIds.recentSuccess,
      workspaceId,
      projectId: projectPrimaryId,
      providerAccountId: openaiAccountId,
      provider: "openai",
      modelId: "gpt-5-mini",
      attemptNumber: 1,
      selectionReason: "Selected the best balanced candidate for the pilot.",
      status: "succeeded",
      startedAt: addSeconds(timestamps.recentSuccessStart, 1),
      completedAt: addSeconds(timestamps.recentSuccessStart, 2),
      latencyMs: 321,
      providerRequestId: `provider_trial_summary_success_${input.smokeId}`,
      createdAt: addSeconds(timestamps.recentSuccessStart, 1),
      updatedAt: addSeconds(timestamps.recentSuccessStart, 2),
    },
    {
      id: `attempt_admin_smoke_trial_summary_failed_${input.smokeId}`,
      requestId: requestIds.recentFailed,
      workspaceId,
      projectId: projectSecondaryId,
      providerAccountId: openaiAccountId,
      provider: "openai",
      modelId: "gpt-5.2",
      attemptNumber: 1,
      selectionReason: "Chose the highest quality candidate still available.",
      status: "failed",
      startedAt: addSeconds(timestamps.recentFailedStart, 1),
      completedAt: addSeconds(timestamps.recentFailedStart, 3),
      latencyMs: 987,
      errorType: "timeout",
      errorCode: "provider_timeout",
      errorMessage: "The provider timed out before completion.",
      providerRequestId: `provider_trial_summary_failed_${input.smokeId}`,
      createdAt: addSeconds(timestamps.recentFailedStart, 1),
      updatedAt: addSeconds(timestamps.recentFailedStart, 3),
    },
    {
      id: `attempt_admin_smoke_trial_summary_running_${input.smokeId}`,
      requestId: requestIds.recentRunning,
      workspaceId,
      projectId: projectSecondaryId,
      providerAccountId: anthropicAccountId,
      provider: "anthropic",
      modelId: "claude-3-5-haiku-20241022",
      attemptNumber: 1,
      selectionReason:
        "Selected the fastest anthropic candidate for the pilot.",
      status: "running",
      startedAt: addSeconds(timestamps.recentRunningStart, 1),
      completedAt: null,
      latencyMs: null,
      providerRequestId: `provider_trial_summary_running_${input.smokeId}`,
      createdAt: addSeconds(timestamps.recentRunningStart, 1),
      updatedAt: addSeconds(timestamps.recentRunningStart, 1),
    },
    {
      id: `attempt_admin_smoke_trial_summary_outside_${input.smokeId}`,
      requestId: requestIds.outsideWindow,
      workspaceId,
      projectId: projectPrimaryId,
      providerAccountId: openaiAccountId,
      provider: "openai",
      modelId: "gpt-5-mini",
      attemptNumber: 1,
      selectionReason:
        "Selected the best balanced candidate before the active pilot window.",
      status: "succeeded",
      startedAt: addSeconds(timestamps.outsideWindowStart, 1),
      completedAt: addSeconds(timestamps.outsideWindowStart, 2),
      latencyMs: 250,
      providerRequestId: `provider_trial_summary_outside_${input.smokeId}`,
      createdAt: addSeconds(timestamps.outsideWindowStart, 1),
      updatedAt: addSeconds(timestamps.outsideWindowStart, 2),
    },
  ]);

  await db.insert(usageRecords).values([
    {
      id: `usage_admin_smoke_trial_summary_success_${input.smokeId}`,
      workspaceId,
      projectId: projectPrimaryId,
      requestId: requestIds.recentSuccess,
      attemptId: `attempt_admin_smoke_trial_summary_success_${input.smokeId}`,
      provider: "openai",
      modelId: "gpt-5-mini",
      usageSource: "estimated",
      inputTokens: 120,
      outputTokens: 45,
      totalTokens: 165,
      costTotal: "0.42000000",
      currency: "USD",
      pricingVersion: "catalog_cost_tier_v1",
      recordedAt: addSeconds(timestamps.recentSuccessStart, 2),
      createdAt: addSeconds(timestamps.recentSuccessStart, 2),
      updatedAt: addSeconds(timestamps.recentSuccessStart, 2),
    },
    {
      id: `usage_admin_smoke_trial_summary_outside_${input.smokeId}`,
      workspaceId,
      projectId: projectPrimaryId,
      requestId: requestIds.outsideWindow,
      attemptId: `attempt_admin_smoke_trial_summary_outside_${input.smokeId}`,
      provider: "openai",
      modelId: "gpt-5-mini",
      usageSource: "estimated",
      inputTokens: 220,
      outputTokens: 80,
      totalTokens: 300,
      costTotal: "0.77000000",
      currency: "USD",
      pricingVersion: "catalog_cost_tier_v1",
      recordedAt: addSeconds(timestamps.outsideWindowStart, 2),
      createdAt: addSeconds(timestamps.outsideWindowStart, 2),
      updatedAt: addSeconds(timestamps.outsideWindowStart, 2),
    },
  ]);

  await db.insert(auditEvents).values([
    {
      id: `audit_admin_smoke_trial_summary_success_routing_${input.smokeId}`,
      workspaceId,
      projectId: projectPrimaryId,
      actorType: "api_key",
      actorApiKeyId: apiKeyPrimaryId,
      eventType: "chat.routing.decision",
      entityType: "request",
      entityId: requestIds.recentSuccess,
      eventPayload: {
        message: "Selected the best balanced candidate for the pilot.",
        routing_decision: {
          outcome: "selected",
          selectionReasonCode: "best_score_for_mode",
          selectionReasonText:
            "Selected the best balanced candidate for the pilot.",
          selected: {
            provider: "openai",
            model: "gpt-5-mini",
          },
        },
      },
      createdAt: addSeconds(timestamps.recentSuccessStart, 1),
    },
    {
      id: `audit_admin_smoke_trial_summary_success_completed_${input.smokeId}`,
      workspaceId,
      projectId: projectPrimaryId,
      actorType: "api_key",
      actorApiKeyId: apiKeyPrimaryId,
      eventType: "chat.completions.completed",
      entityType: "request",
      entityId: requestIds.recentSuccess,
      eventPayload: {
        message:
          "Request completed successfully for the pilot trial summary smoke.",
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
            "Selected the best balanced candidate for the pilot.",
        },
      },
      createdAt: addSeconds(timestamps.recentSuccessStart, 2),
    },
    {
      id: `audit_admin_smoke_trial_summary_failed_routing_${input.smokeId}`,
      workspaceId,
      projectId: projectSecondaryId,
      actorType: "api_key",
      actorApiKeyId: apiKeySecondaryId,
      eventType: "chat.routing.decision",
      entityType: "request",
      entityId: requestIds.recentFailed,
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
      createdAt: addSeconds(timestamps.recentFailedStart, 1),
    },
    {
      id: `audit_admin_smoke_trial_summary_failed_failed_${input.smokeId}`,
      workspaceId,
      projectId: projectSecondaryId,
      actorType: "api_key",
      actorApiKeyId: apiKeySecondaryId,
      eventType: "chat.completions.failed",
      entityType: "request",
      entityId: requestIds.recentFailed,
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
          usage_recorded: false,
          cost_total_usd: 0.12,
          currency: "USD",
          selection_reason_code: "best_quality_candidate",
          selection_reason_text:
            "Chose the highest quality candidate still available.",
        },
      },
      createdAt: addSeconds(timestamps.recentFailedStart, 3),
    },
    {
      id: `audit_admin_smoke_trial_summary_blocked_routing_${input.smokeId}`,
      workspaceId,
      projectId: projectPrimaryId,
      actorType: "api_key",
      actorApiKeyId: apiKeyPrimaryId,
      eventType: "chat.routing.decision",
      entityType: "request",
      entityId: requestIds.recentBlocked,
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
      createdAt: addSeconds(timestamps.recentBlockedStart, 1),
    },
    {
      id: `audit_admin_smoke_trial_summary_blocked_blocked_${input.smokeId}`,
      workspaceId,
      projectId: projectPrimaryId,
      actorType: "api_key",
      actorApiKeyId: apiKeyPrimaryId,
      eventType: "chat.completions.blocked",
      entityType: "request",
      entityId: requestIds.recentBlocked,
      eventPayload: {
        message:
          "Workspace budget cap blocked this request before provider execution.",
        metadata: {
          mode: "budget",
          request_status: "blocked",
          error_code: "policy_blocked_budget_cap",
          selection_reason_code: "policy_blocked_budget_cap",
          selection_reason_text:
            "Blocked because the workspace monthly gateway-recorded budget cap has already been reached.",
          cost_total_usd: 0,
          currency: "USD",
        },
      },
      createdAt: addMinutes(timestamps.recentBlockedStart, 1),
    },
    {
      id: `audit_admin_smoke_trial_summary_running_routing_${input.smokeId}`,
      workspaceId,
      projectId: projectSecondaryId,
      actorType: "api_key",
      actorApiKeyId: apiKeySecondaryId,
      eventType: "chat.routing.decision",
      entityType: "request",
      entityId: requestIds.recentRunning,
      eventPayload: {
        message: "Selected the fastest anthropic candidate for the pilot.",
        routing_decision: {
          outcome: "selected",
          selectionReasonCode: "fastest_candidate",
          selectionReasonText:
            "Selected the fastest anthropic candidate for the pilot.",
          selected: {
            provider: "anthropic",
            model: "claude-3-5-haiku-20241022",
          },
        },
      },
      createdAt: addSeconds(timestamps.recentRunningStart, 1),
    },
    {
      id: `audit_admin_smoke_trial_summary_audit_only_routing_${input.smokeId}`,
      workspaceId,
      projectId: projectPrimaryId,
      actorType: "api_key",
      actorApiKeyId: apiKeyPrimaryId,
      eventType: "chat.routing.decision",
      entityType: "request",
      entityId: requestIds.auditOnlySuccess,
      eventPayload: {
        message:
          "Selected the lowest-cost budget candidate inside the 30d-only window.",
        routing_decision: {
          outcome: "selected",
          selectionReasonCode: "lowest_cost_candidate",
          selectionReasonText:
            "Selected the lowest-cost budget candidate inside the 30d-only window.",
          selected: {
            provider: "anthropic",
            model: "claude-3-5-haiku-20241022",
          },
        },
      },
      createdAt: addSeconds(timestamps.auditOnlyStart, 1),
    },
    {
      id: `audit_admin_smoke_trial_summary_audit_only_completed_${input.smokeId}`,
      workspaceId,
      projectId: projectPrimaryId,
      actorType: "api_key",
      actorApiKeyId: apiKeyPrimaryId,
      eventType: "chat.completions.completed",
      entityType: "request",
      entityId: requestIds.auditOnlySuccess,
      eventPayload: {
        message:
          "Request completed successfully inside the 30d-only window for CSV verification.",
        metadata: {
          mode: "budget",
          request_status: "succeeded",
          provider: "anthropic",
          model: "claude-3-5-haiku-20241022",
          latency_ms: 450,
          usage_recorded: false,
          cost_total_usd: 0.19,
          currency: "USD",
          selection_reason_code: "lowest_cost_candidate",
          selection_reason_text:
            "Selected the lowest-cost budget candidate inside the 30d-only window.",
        },
      },
      createdAt: addSeconds(timestamps.auditOnlyStart, 2),
    },
    {
      id: `audit_admin_smoke_trial_summary_outside_routing_${input.smokeId}`,
      workspaceId,
      projectId: projectPrimaryId,
      actorType: "api_key",
      actorApiKeyId: apiKeyPrimaryId,
      eventType: "chat.routing.decision",
      entityType: "request",
      entityId: requestIds.outsideWindow,
      eventPayload: {
        message:
          "Selected the best balanced candidate before the active pilot window.",
        routing_decision: {
          outcome: "selected",
          selectionReasonCode: "best_score_for_mode",
          selectionReasonText:
            "Selected the best balanced candidate before the active pilot window.",
          selected: {
            provider: "openai",
            model: "gpt-5-mini",
          },
        },
      },
      createdAt: addSeconds(timestamps.outsideWindowStart, 1),
    },
    {
      id: `audit_admin_smoke_trial_summary_outside_completed_${input.smokeId}`,
      workspaceId,
      projectId: projectPrimaryId,
      actorType: "api_key",
      actorApiKeyId: apiKeyPrimaryId,
      eventType: "chat.completions.completed",
      entityType: "request",
      entityId: requestIds.outsideWindow,
      eventPayload: {
        message:
          "Request completed successfully outside the active pilot window.",
        metadata: {
          mode: "balanced",
          request_status: "succeeded",
          provider: "openai",
          model: "gpt-5-mini",
          latency_ms: 250,
          usage_recorded: true,
          cost_total_usd: 0.77,
          currency: "USD",
          selection_reason_code: "best_score_for_mode",
          selection_reason_text:
            "Selected the best balanced candidate before the active pilot window.",
        },
      },
      createdAt: addSeconds(timestamps.outsideWindowStart, 2),
    },
  ]);

  return {
    db,
    queryClient,
    workspace: {
      id: workspaceId,
      slug: workspaceSlug,
      name: workspaceName,
    },
    projects: {
      primary: {
        id: projectPrimaryId,
        name: projectNames.primary,
        slug: projectSlugs.primary,
      },
      secondary: {
        id: projectSecondaryId,
        name: projectNames.secondary,
        slug: projectSlugs.secondary,
      },
    },
    requestIds,
    providerSecrets,
    promptMarkers: PROMPT_MARKERS,
  };
}

async function cleanupSmokeFixture(input) {
  const dbModule = loadDbModule();
  const drizzleModule = loadDrizzleModule();
  const {
    auditEvents,
    gatewayApiKeys,
    projects,
    providerAccounts,
    requestAttempts,
    requests,
    usageRecords,
    workspaces,
  } = dbModule;
  const { eq } = drizzleModule;

  await input.db
    .delete(auditEvents)
    .where(eq(auditEvents.workspaceId, input.workspace.id));
  await input.db
    .delete(usageRecords)
    .where(eq(usageRecords.workspaceId, input.workspace.id));
  await input.db
    .delete(requestAttempts)
    .where(eq(requestAttempts.workspaceId, input.workspace.id));
  await input.db
    .delete(requests)
    .where(eq(requests.workspaceId, input.workspace.id));
  await input.db
    .delete(gatewayApiKeys)
    .where(eq(gatewayApiKeys.workspaceId, input.workspace.id));
  await input.db
    .delete(providerAccounts)
    .where(eq(providerAccounts.workspaceId, input.workspace.id));
  await input.db
    .delete(projects)
    .where(eq(projects.workspaceId, input.workspace.id));
  await input.db
    .delete(workspaces)
    .where(eq(workspaces.id, input.workspace.id));

  return {
    workspaceRemoved: true,
    workspaceId: input.workspace.id,
  };
}

async function loginToAdmin(input) {
  await input.page.enable();
  await input.page.navigate(`${input.baseUrl}/login`, "/login");

  const loginHeading = await input.page.evaluate(
    "document.querySelector('h1')?.textContent?.trim() ?? null",
  );

  if (!loginHeading?.includes("Temporary admin login")) {
    throw createSmokeError(
      "The login page heading did not match the admin gate.",
    );
  }

  await input.page.evaluate(`(() => {
    const passwordInput = document.querySelector('input[name="password"]');

    if (!(passwordInput instanceof HTMLInputElement)) {
      throw new Error("password input missing");
    }

    passwordInput.focus();
    passwordInput.value = ${JSON.stringify(input.password)};
    passwordInput.dispatchEvent(new Event("input", { bubbles: true }));

    const form = passwordInput.form;

    if (!(form instanceof HTMLFormElement)) {
      throw new Error("login form missing");
    }

    form.requestSubmit();
    return true;
  })()`);

  await waitFor(
    async () => {
      const state = await input.page.evaluate(
        `({ path: location.pathname, ready: document.readyState })`,
      );

      return state.path === "/" && state.ready === "complete" ? state : null;
    },
    PAGE_NAVIGATION_TIMEOUT_MS,
    "post-login redirect",
  );

  return {
    loginHeading,
  };
}

async function waitForBodyText(input) {
  return waitFor(
    async () => {
      const state = await input.page.evaluate(
        `({
        path: location.pathname,
        search: location.search,
        ready: document.readyState,
        text: document.body.innerText,
        lower: document.body.innerText.toLowerCase()
      })`,
      );
      const pathMatches =
        !input.expectedPath || state.path === input.expectedPath;
      const hasAllText = input.includes.every((value) =>
        state.text.includes(value),
      );
      const hasNoExcludedText = (input.excludes ?? []).every(
        (value) => !state.text.includes(value),
      );

      return state.ready === "complete" &&
        pathMatches &&
        hasAllText &&
        hasNoExcludedText
        ? state
        : null;
    },
    PAGE_ASSERTION_TIMEOUT_MS,
    input.label,
  );
}

async function readTrialSummaryState(page) {
  return page.evaluate(`(() => {
    const text = document.body.innerText;
    const metricCards = {};

    for (const article of document.querySelectorAll("article")) {
      const paragraphs = Array.from(article.querySelectorAll("p"));
      const label = paragraphs[0]?.textContent?.trim();
      const value = paragraphs[1]?.textContent?.trim();

      if (
        label &&
        value &&
        ["Requests", "Total cost", "Succeeded", "Blocked", "Failed"].includes(label)
      ) {
        metricCards[label] = value;
      }
    }

    const links = Object.fromEntries(
      Array.from(document.querySelectorAll("a"))
        .map((anchor) => [
          anchor.textContent?.trim() ?? "",
          anchor.getAttribute("href") ?? "",
        ])
        .filter(([label]) => label.length > 0),
    );

    return {
      path: location.pathname,
      search: location.search,
      ready: document.readyState,
      text,
      lower: text.toLowerCase(),
      metricCards,
      links,
    };
  })()`);
}

async function waitForTrialSummaryState(input) {
  return waitFor(
    async () => {
      const state = await readTrialSummaryState(input.page);

      return state.path === "/trial-summary" &&
        state.ready === "complete" &&
        state.metricCards.Requests === String(input.expectedRequestCount) &&
        state.links["Download Requests CSV"] ===
          `/requests/export?range=${input.range}` &&
        state.links["Download Audit CSV"] ===
          `/audit/export?range=${input.range}` &&
        state.text.includes(input.projectNames.primary) &&
        state.text.includes(input.projectNames.secondary)
        ? state
        : null;
    },
    PAGE_ASSERTION_TIMEOUT_MS,
    `trial summary ${input.range} assertions`,
  );
}

async function fetchExportViaPage(input) {
  return input.page.evaluate(`(async () => {
    const response = await fetch(${JSON.stringify(input.path)}, {
      method: "GET",
      credentials: "include",
      cache: "no-store",
    });

    return {
      status: response.status,
      contentType: response.headers.get("content-type"),
      disposition: response.headers.get("content-disposition"),
      text: await response.text(),
    };
  })()`);
}

function assertCommonCsvConstraints(input) {
  assert.equal(
    input.summary.status,
    200,
    `${input.label} returned HTTP ${input.summary.status}.`,
  );
  assert.ok(
    input.summary.contentType?.startsWith("text/csv"),
    `${input.label} did not return text/csv.`,
  );
  assert.ok(
    input.filenamePattern.test(input.summary.disposition ?? ""),
    `${input.label} filename was not deterministic: ${input.summary.disposition ?? "missing"}.`,
  );
  assert.ok(
    input.summary.text.startsWith(input.expectedHeader),
    `${input.label} header did not match the expected CSV columns.`,
  );

  for (const value of input.disallowedValues) {
    assert.ok(
      !input.summary.text.includes(value),
      `${input.label} unexpectedly exposed a disallowed value: ${value}.`,
    );
  }
}

async function saveManualFeedbackViaUi(input) {
  await input.page.evaluate(`(() => {
    const card = document.getElementById(${JSON.stringify(
      getRequestAnchorId(input.requestId),
    )});

    if (!(card instanceof HTMLElement)) {
      throw new Error("request card missing");
    }

    const form = card.querySelector("form");
    const select = card.querySelector('select[name="value"]');
    const noteInput = card.querySelector('input[name="note"]');

    if (!(form instanceof HTMLFormElement)) {
      throw new Error("feedback form missing");
    }

    if (!(select instanceof HTMLSelectElement)) {
      throw new Error("feedback outcome select missing");
    }

    if (!(noteInput instanceof HTMLInputElement)) {
      throw new Error("feedback note input missing");
    }

    select.focus();
    select.value = ${JSON.stringify(input.value)};
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));

    noteInput.focus();
    noteInput.value = ${JSON.stringify(input.note)};
    noteInput.dispatchEvent(new Event("input", { bubbles: true }));

    form.requestSubmit();
    return true;
  })()`);

  return waitForBodyText({
    page: input.page,
    expectedPath: "/requests",
    includes: [
      "Saved manual outcome feedback for this request.",
      "Useful",
      input.note,
      input.requestId,
    ],
    label: "manual outcome feedback save",
  });
}

async function runTrialSummaryBrowserSmoke(input) {
  const target = await openBrowserTarget(input.debugPort);
  const page = await createPageClient(target.webSocketDebuggerUrl);

  try {
    const loginState = await loginToAdmin({
      page,
      baseUrl: input.baseUrl,
      password: input.password,
    });

    await page.navigate(`${input.baseUrl}/trial-summary`, "/trial-summary");

    const summary30d = await waitForTrialSummaryState({
      page,
      range: "30d",
      expectedRequestCount: 5,
      projectNames: input.projectNames,
    });

    const requestsExport30d = await fetchExportViaPage({
      page,
      path: "/requests/export?range=30d",
    });
    const auditExport30d = await fetchExportViaPage({
      page,
      path: "/audit/export?range=30d",
    });
    const disallowedValues = [
      input.promptMarkers.recentSuccess,
      input.promptMarkers.recentFailed,
      input.promptMarkers.recentBlocked,
      input.promptMarkers.recentRunning,
      input.promptMarkers.auditOnlySuccess,
      input.promptMarkers.outsideWindow,
      input.providerSecrets.openai,
      input.providerSecrets.anthropic,
    ];

    assertCommonCsvConstraints({
      label: "Requests CSV 30d",
      summary: requestsExport30d,
      filenamePattern: buildFilenamePattern(
        "requests",
        input.workspaceSlug,
        "30d",
      ),
      expectedHeader: REQUESTS_CSV_HEADER,
      disallowedValues,
    });
    assertCommonCsvConstraints({
      label: "Audit CSV 30d",
      summary: auditExport30d,
      filenamePattern: buildFilenamePattern(
        "audit",
        input.workspaceSlug,
        "30d",
      ),
      expectedHeader: AUDIT_CSV_HEADER,
      disallowedValues,
    });

    assert.equal(
      countCsvLines(requestsExport30d.text),
      6,
      "Requests CSV 30d should contain one header and five request rows.",
    );
    assert.ok(
      requestsExport30d.text.includes(
        "Selected the lowest-cost budget candidate inside the 30d-only window.",
      ),
      "Requests CSV 30d did not include the 30d-only request evidence.",
    );
    assert.ok(
      auditExport30d.text.includes(input.requestIds.auditOnlySuccess),
      "Audit CSV 30d did not include the 30d-only audit trail.",
    );
    assert.ok(
      !auditExport30d.text.includes("request.feedback_recorded"),
      "Audit CSV 30d should not contain manual feedback before it is submitted.",
    );

    await page.navigate(
      `${input.baseUrl}/trial-summary?range=7d`,
      "/trial-summary",
    );

    const summary7d = await waitForTrialSummaryState({
      page,
      range: "7d",
      expectedRequestCount: 4,
      projectNames: input.projectNames,
    });

    const requestsExport7d = await fetchExportViaPage({
      page,
      path: "/requests/export?range=7d",
    });
    const auditExport7d = await fetchExportViaPage({
      page,
      path: "/audit/export?range=7d",
    });

    assertCommonCsvConstraints({
      label: "Requests CSV 7d",
      summary: requestsExport7d,
      filenamePattern: buildFilenamePattern(
        "requests",
        input.workspaceSlug,
        "7d",
      ),
      expectedHeader: REQUESTS_CSV_HEADER,
      disallowedValues,
    });
    assertCommonCsvConstraints({
      label: "Audit CSV 7d",
      summary: auditExport7d,
      filenamePattern: buildFilenamePattern("audit", input.workspaceSlug, "7d"),
      expectedHeader: AUDIT_CSV_HEADER,
      disallowedValues,
    });

    assert.equal(
      countCsvLines(requestsExport7d.text),
      5,
      "Requests CSV 7d should contain one header and four request rows.",
    );
    assert.ok(
      !requestsExport7d.text.includes(
        "Selected the lowest-cost budget candidate inside the 30d-only window.",
      ),
      "Requests CSV 7d should exclude the 30d-only request evidence.",
    );
    assert.ok(
      !auditExport7d.text.includes(input.requestIds.auditOnlySuccess),
      "Audit CSV 7d should exclude the 30d-only audit trail.",
    );

    const requestsPath = `/requests?project=${encodeURIComponent(input.projectId)}`;
    await page.navigate(`${input.baseUrl}${requestsPath}`, "/requests");

    const requestsState = await page.evaluate(`(() => {
      const text = document.body.innerText;

      return {
        path: location.pathname,
        ready: document.readyState,
        text,
      };
    })()`);

    assert.equal(
      requestsState.path,
      "/requests",
      "Requests navigation did not land on /requests.",
    );
    assert.equal(
      requestsState.ready,
      "complete",
      "Requests page did not finish loading before feedback submission.",
    );

    const feedbackState = await saveManualFeedbackViaUi({
      page,
      requestId: input.requestIds.recentSuccess,
      value: "useful",
      note: FEEDBACK_NOTE,
    });

    const auditExportAfterFeedback = await fetchExportViaPage({
      page,
      path: "/audit/export?range=30d",
    });

    assertCommonCsvConstraints({
      label: "Audit CSV 30d after feedback",
      summary: auditExportAfterFeedback,
      filenamePattern: buildFilenamePattern(
        "audit",
        input.workspaceSlug,
        "30d",
      ),
      expectedHeader: AUDIT_CSV_HEADER,
      disallowedValues,
    });
    assert.ok(
      auditExportAfterFeedback.text.includes("request.feedback_recorded"),
      "Audit CSV 30d did not include the recorded manual feedback event.",
    );
    assert.ok(
      auditExportAfterFeedback.text.includes(input.requestIds.recentSuccess),
      "Audit CSV 30d did not include the request id for the saved manual feedback.",
    );

    return {
      loginHeading: loginState.loginHeading,
      trialSummary30dRequestCount: summary30d.metricCards.Requests,
      trialSummary7dRequestCount: summary7d.metricCards.Requests,
      requestsCsv30dLineCount: countCsvLines(requestsExport30d.text),
      requestsCsv7dLineCount: countCsvLines(requestsExport7d.text),
      auditCsv30dIncludesFeedback: auditExportAfterFeedback.text.includes(
        "request.feedback_recorded",
      ),
      workspaceTargetedViaFilename:
        requestsExport30d.disposition ?? "missing-content-disposition",
      requestsPageProjectPresent: requestsState.text.includes(
        input.projectNames.primary,
      ),
      feedbackNoticePresent: feedbackState.text.includes(
        "Saved manual outcome feedback for this request.",
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
    `nl-admin-smoke-trial-summary-${Date.now()}`,
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

    fixture = await createSmokeFixture({
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
        ADMIN_WORKSPACE_ID: fixture.workspace.id,
        ADMIN_SMOKE_WORKSPACE_ID: "",
        PROVIDER_CREDENTIALS_SECRET: providerCredentialsSecret,
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

    logStep("Running browser-driven Trial summary, export, and feedback smoke");
    const browserSummary = await runTrialSummaryBrowserSmoke({
      baseUrl,
      debugPort,
      password,
      workspaceSlug: fixture.workspace.slug,
      projectId: fixture.projects.primary.id,
      projectNames: {
        primary: fixture.projects.primary.name,
        secondary: fixture.projects.secondary.name,
      },
      requestIds: fixture.requestIds,
      providerSecrets: fixture.providerSecrets,
      promptMarkers: fixture.promptMarkers,
    });

    cleanupSummary = await cleanupSmokeFixture(fixture);
    await fixture.queryClient.end({ timeout: 5 });
    fixture.queryClient = null;

    console.log(
      JSON.stringify(
        {
          workspace: fixture.workspace,
          projects: fixture.projects,
          requestIds: fixture.requestIds,
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

    console.error(`[admin:smoke:trial-summary] ${errorMessage}`);

    if (adminServer) {
      const processLogs = formatManagedProcessLogs(adminServer);

      if (processLogs) {
        console.error(processLogs);
      }
    }

    if (fixture && !cleanupSummary) {
      try {
        cleanupSummary = await cleanupSmokeFixture(fixture);
      } catch (cleanupError) {
        const cleanupMessage =
          cleanupError instanceof Error
            ? cleanupError.message
            : "Unknown cleanup failure.";
        console.error(
          `[admin:smoke:trial-summary] Cleanup warning: ${cleanupMessage}`,
        );
      }
    }

    process.exitCode = 1;
  } finally {
    if (fixture?.queryClient) {
      await fixture.queryClient.end({ timeout: 5 }).catch(() => undefined);
    }

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
    `[admin:smoke:trial-summary] Fatal error: ${
      error instanceof Error ? (error.stack ?? error.message) : String(error)
    }`,
  );
  process.exit(1);
});
