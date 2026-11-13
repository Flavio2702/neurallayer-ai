import type { RequestStatus } from "@neuralayer/core";

import type { Database } from "./client";
import { withDatabase } from "./connection-helpers";
import {
  MANUAL_REQUEST_FEEDBACK_EVENT_TYPE,
  MANUAL_REQUEST_FEEDBACK_VALUES,
  type ManualRequestFeedbackValue,
} from "./manual-request-feedback-service";
import {
  extractRuntimeOutcomeSummary,
  REQUEST_RUNTIME_AUDIT_EVENT_TYPES,
  type RequestRuntimeAttemptRecord,
  type RequestRuntimeAuditEventRecord,
  type RequestRuntimeCostSummary,
  type RequestRuntimeIssueSummary,
  type RequestRuntimeRequestRecord,
  type RequestRuntimeSelectionReason,
  type RequestRuntimeUsageRecord,
  type RequestRuntimeUsageSummary,
  type RuntimeAuditEventType,
  resolveProjectSummary,
  resolveRequestRuntimeSummary,
  toOptionalString,
} from "./request-runtime-lineage";

const FEED_SCAN_MULTIPLIER = 10;
const FEED_MIN_SCAN_LIMIT = 50;
const FEED_MAX_SCAN_LIMIT = 250;

export type RequestsPageFeedUsage = RequestRuntimeUsageSummary;
export type RequestsPageFeedCost = RequestRuntimeCostSummary;
export type RequestsPageSelectionReason = RequestRuntimeSelectionReason;
export type RequestsPageIssueSummary = RequestRuntimeIssueSummary;

export interface RequestsPageManualFeedback {
  value: ManualRequestFeedbackValue;
  note: string | null;
  recordedAt: string;
}

export interface RequestsPageFeedItem {
  requestId: string;
  timestamp: string;
  completedAt: string | null;
  project: {
    id: string;
    name: string;
    slug: string | null;
  };
  mode: string;
  provider: string | null;
  model: string | null;
  status: RequestStatus;
  latencyMs: number | null;
  usage: RequestsPageFeedUsage | null;
  cost: RequestsPageFeedCost | null;
  selectionReason: RequestsPageSelectionReason;
  issue: RequestsPageIssueSummary | null;
  manualFeedback: RequestsPageManualFeedback | null;
}

export interface RequestsPageBlockedRecentItem {
  requestId: string;
  timestamp: string;
  project: {
    id: string | null;
    name: string;
    slug: string | null;
  };
  mode: string | null;
  reason: RequestsPageSelectionReason;
}

export interface RequestsPageRecentAuditItem {
  requestId: string;
  timestamp: string;
  eventType: RuntimeAuditEventType;
  project: {
    id: string | null;
    name: string;
    slug: string | null;
  };
  mode: string | null;
  provider: string | null;
  model: string | null;
  status: RequestStatus | null;
  message: string | null;
  errorCode: string | null;
  errorType: string | null;
  costTotalUsd: number | null;
}

export interface RequestsPageData {
  feed: RequestsPageFeedItem[];
  blockedRecent: RequestsPageBlockedRecentItem[];
  recentAudit: RequestsPageRecentAuditItem[];
}

export interface GetRequestsPageDataInput {
  workspaceId: string;
  projectId?: string;
  status?: RequestStatus;
  limit?: number;
  blockedLimit?: number;
  auditLimit?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getFeedScanLimit(limit: number) {
  return Math.min(
    Math.max(limit * FEED_SCAN_MULTIPLIER, FEED_MIN_SCAN_LIMIT),
    FEED_MAX_SCAN_LIMIT,
  );
}

function isManualRequestFeedbackValue(
  value: unknown,
): value is ManualRequestFeedbackValue {
  return MANUAL_REQUEST_FEEDBACK_VALUES.includes(
    value as ManualRequestFeedbackValue,
  );
}

function parseManualRequestFeedbackNote(note: unknown) {
  if (typeof note !== "string") {
    return null;
  }

  const trimmedNote = note.trim();

  return trimmedNote.length > 0 ? trimmedNote : null;
}

function toFeedItem(input: {
  requestRow: RequestRuntimeRequestRecord;
  latestAttempt: RequestRuntimeAttemptRecord | null;
  usageRecord: RequestRuntimeUsageRecord | null;
  requestEvents: RequestRuntimeAuditEventRecord[];
}): RequestsPageFeedItem {
  const summary = resolveRequestRuntimeSummary(input);

  return {
    requestId: summary.requestId,
    timestamp: summary.timestamp,
    completedAt: summary.completedAt,
    project: summary.project,
    mode: summary.mode,
    provider: summary.provider,
    model: summary.model,
    status: summary.status,
    latencyMs: summary.latencyMs,
    usage: summary.usage,
    cost: summary.cost,
    selectionReason: summary.selectionReason,
    issue: summary.issue,
    manualFeedback: null,
  };
}

function toManualFeedback(input: {
  eventPayload: unknown;
  createdAt: Date;
}): RequestsPageManualFeedback | null {
  if (!isRecord(input.eventPayload)) {
    return null;
  }

  const feedback = isRecord(input.eventPayload.feedback)
    ? input.eventPayload.feedback
    : null;

  if (!feedback || !isManualRequestFeedbackValue(feedback.value)) {
    return null;
  }

  return {
    value: feedback.value,
    note: parseManualRequestFeedbackNote(feedback.note),
    recordedAt: input.createdAt.toISOString(),
  };
}

function toBlockedRecentItem(
  event: RequestRuntimeAuditEventRecord,
): RequestsPageBlockedRecentItem | null {
  if (!isRecord(event.eventPayload)) {
    return null;
  }

  const payload = event.eventPayload;
  const metadata = isRecord(payload.metadata) ? payload.metadata : null;

  return {
    requestId: event.entityId,
    timestamp: event.createdAt.toISOString(),
    project: resolveProjectSummary(event.project, {
      id: event.projectId,
      name: "Unknown project",
      slug: null,
    }),
    mode:
      toOptionalString(metadata?.mode) ??
      toOptionalString(payload.mode) ??
      null,
    reason: {
      code:
        toOptionalString(metadata?.error_code) ??
        toOptionalString(metadata?.selection_reason_code),
      text:
        toOptionalString(payload.message) ??
        toOptionalString(metadata?.selection_reason_text),
    },
  };
}

function toRecentAuditItem(
  event: RequestRuntimeAuditEventRecord,
): RequestsPageRecentAuditItem | null {
  const summary = extractRuntimeOutcomeSummary(event);

  if (!summary) {
    return null;
  }

  return {
    requestId: event.entityId,
    timestamp: summary.timestamp,
    eventType: summary.eventType,
    project: resolveProjectSummary(event.project, {
      id: event.projectId,
      name: "Unknown project",
      slug: null,
    }),
    mode:
      isRecord(event.eventPayload) && isRecord(event.eventPayload.metadata)
        ? toOptionalString(event.eventPayload.metadata.mode)
        : null,
    provider: summary.provider,
    model: summary.model,
    status: summary.requestStatus,
    message: summary.message,
    errorCode: summary.errorCode,
    errorType: summary.errorType,
    costTotalUsd: summary.costTotalUsd,
  };
}

export async function getRequestsPageData(
  input: GetRequestsPageDataInput,
  database?: Database,
): Promise<RequestsPageData> {
  return withDatabase(database, async (db) => {
    const requestedLimit = Math.max(input.limit ?? 20, 1);
    const blockedLimit = Math.max(input.blockedLimit ?? 6, 1);
    const auditLimit = Math.max(input.auditLimit ?? 10, 1);
    const requestRows = await db.query.requests.findMany({
      where: (table, { and, eq }) =>
        input.projectId
          ? and(
              eq(table.workspaceId, input.workspaceId),
              eq(table.projectId, input.projectId),
            )
          : eq(table.workspaceId, input.workspaceId),
      with: {
        project: true,
      },
      orderBy: (table, { desc: queryDesc }) => [
        queryDesc(table.startedAt),
        queryDesc(table.id),
      ],
      limit: getFeedScanLimit(requestedLimit),
    });
    const requestIds = requestRows.map((row) => row.id);
    const [
      attemptRows,
      usageRows,
      auditRows,
      blockedAuditRows,
      recentAuditRows,
    ] = await Promise.all([
      requestIds.length === 0
        ? Promise.resolve([] satisfies RequestRuntimeAttemptRecord[])
        : db.query.requestAttempts.findMany({
            where: (table, { inArray: queryInArray }) =>
              queryInArray(table.requestId, requestIds),
            orderBy: (table, { desc: queryDesc }) => [
              queryDesc(table.completedAt),
              queryDesc(table.startedAt),
              queryDesc(table.attemptNumber),
            ],
          }),
      requestIds.length === 0
        ? Promise.resolve([] satisfies RequestRuntimeUsageRecord[])
        : db.query.usageRecords.findMany({
            where: (table, { inArray: queryInArray }) =>
              queryInArray(table.requestId, requestIds),
            orderBy: (table, { desc: queryDesc }) => [
              queryDesc(table.recordedAt),
              queryDesc(table.id),
            ],
          }),
      requestIds.length === 0
        ? Promise.resolve([] satisfies RequestRuntimeAuditEventRecord[])
        : db.query.auditEvents.findMany({
            where: (
              table,
              { and: queryAnd, eq: queryEq, inArray: queryInArray },
            ) =>
              queryAnd(
                queryEq(table.workspaceId, input.workspaceId),
                queryEq(table.entityType, "request"),
                queryInArray(table.entityId, requestIds),
              ),
            with: {
              project: true,
            },
            orderBy: (table, { desc: queryDesc }) => [
              queryDesc(table.createdAt),
              queryDesc(table.id),
            ],
          }),
      db.query.auditEvents.findMany({
        where: (table, { and: queryAnd, eq: queryEq }) =>
          input.projectId
            ? queryAnd(
                queryEq(table.workspaceId, input.workspaceId),
                queryEq(table.projectId, input.projectId),
                queryEq(table.entityType, "request"),
                queryEq(table.eventType, "chat.completions.blocked"),
              )
            : queryAnd(
                queryEq(table.workspaceId, input.workspaceId),
                queryEq(table.entityType, "request"),
                queryEq(table.eventType, "chat.completions.blocked"),
              ),
        with: {
          project: true,
        },
        orderBy: (table, { desc: queryDesc }) => [
          queryDesc(table.createdAt),
          queryDesc(table.id),
        ],
        limit: blockedLimit,
      }),
      db.query.auditEvents.findMany({
        where: (
          table,
          { and: queryAnd, eq: queryEq, inArray: queryInArray },
        ) =>
          input.projectId
            ? queryAnd(
                queryEq(table.workspaceId, input.workspaceId),
                queryEq(table.projectId, input.projectId),
                queryEq(table.entityType, "request"),
                queryInArray(table.eventType, [
                  ...REQUEST_RUNTIME_AUDIT_EVENT_TYPES,
                ]),
              )
            : queryAnd(
                queryEq(table.workspaceId, input.workspaceId),
                queryEq(table.entityType, "request"),
                queryInArray(table.eventType, [
                  ...REQUEST_RUNTIME_AUDIT_EVENT_TYPES,
                ]),
              ),
        with: {
          project: true,
        },
        orderBy: (table, { desc: queryDesc }) => [
          queryDesc(table.createdAt),
          queryDesc(table.id),
        ],
        limit: auditLimit,
      }),
    ]);
    const latestAttemptByRequestId = new Map<
      string,
      RequestRuntimeAttemptRecord
    >();
    const latestUsageByRequestId = new Map<string, RequestRuntimeUsageRecord>();
    const auditEventsByRequestId = new Map<
      string,
      RequestRuntimeAuditEventRecord[]
    >();

    for (const attempt of attemptRows) {
      if (!latestAttemptByRequestId.has(attempt.requestId)) {
        latestAttemptByRequestId.set(attempt.requestId, attempt);
      }
    }

    for (const usageRecord of usageRows) {
      if (!latestUsageByRequestId.has(usageRecord.requestId)) {
        latestUsageByRequestId.set(usageRecord.requestId, usageRecord);
      }
    }

    for (const auditEvent of auditRows) {
      const currentEvents =
        auditEventsByRequestId.get(auditEvent.entityId) ?? [];

      currentEvents.push(auditEvent);
      auditEventsByRequestId.set(auditEvent.entityId, currentEvents);
    }

    const baseFeed = requestRows
      .map((requestRow) =>
        toFeedItem({
          requestRow,
          latestAttempt: latestAttemptByRequestId.get(requestRow.id) ?? null,
          usageRecord: latestUsageByRequestId.get(requestRow.id) ?? null,
          requestEvents: auditEventsByRequestId.get(requestRow.id) ?? [],
        }),
      )
      .filter((item) => (input.status ? item.status === input.status : true))
      .slice(0, requestedLimit);
    const feedRequestIds = baseFeed.map((item) => item.requestId);
    const manualFeedbackRows =
      feedRequestIds.length === 0
        ? []
        : await db.query.auditEvents.findMany({
            where: (
              table,
              { and: queryAnd, eq: queryEq, inArray: queryInArray },
            ) =>
              queryAnd(
                queryEq(table.workspaceId, input.workspaceId),
                queryEq(table.entityType, "request"),
                queryEq(table.eventType, MANUAL_REQUEST_FEEDBACK_EVENT_TYPE),
                queryInArray(table.entityId, feedRequestIds),
              ),
            orderBy: (table, { desc: queryDesc }) => [
              queryDesc(table.createdAt),
              queryDesc(table.id),
            ],
          });
    const manualFeedbackByRequestId = new Map<
      string,
      RequestsPageManualFeedback
    >();

    for (const feedbackRow of manualFeedbackRows) {
      if (manualFeedbackByRequestId.has(feedbackRow.entityId)) {
        continue;
      }

      const manualFeedback = toManualFeedback({
        eventPayload: feedbackRow.eventPayload,
        createdAt: feedbackRow.createdAt,
      });

      if (manualFeedback) {
        manualFeedbackByRequestId.set(feedbackRow.entityId, manualFeedback);
      }
    }
    const feed = baseFeed.map((item) => ({
      ...item,
      manualFeedback: manualFeedbackByRequestId.get(item.requestId) ?? null,
    }));

    return {
      feed,
      blockedRecent: blockedAuditRows
        .map(toBlockedRecentItem)
        .filter((item): item is RequestsPageBlockedRecentItem => item !== null),
      recentAudit: recentAuditRows
        .map(toRecentAuditItem)
        .filter((item): item is RequestsPageRecentAuditItem => item !== null),
    };
  });
}
