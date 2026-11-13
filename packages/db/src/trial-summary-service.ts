import {
  MODE_VALUES,
  type Mode,
  PROVIDER_NAME_VALUES,
  type RequestStatus,
} from "@neuralayer/core";

import type { Database } from "./client";
import { withDatabase } from "./connection-helpers";
import {
  type RequestRuntimeAttemptRecord,
  type RequestRuntimeAuditEventRecord,
  type RequestRuntimeRequestRecord,
  type RequestRuntimeUsageRecord,
  type RuntimeAuditEventType,
  resolveRequestRuntimeSummary,
} from "./request-runtime-lineage";

export const TRIAL_SUMMARY_RANGE_VALUES = ["7d", "30d"] as const;

export type TrialSummaryRange = (typeof TRIAL_SUMMARY_RANGE_VALUES)[number];

export interface TrialSummaryWindow {
  range: TrialSummaryRange;
  start: string;
  end: string;
}

export interface TrialSummaryTotals {
  requestCount: number;
  succeededCount: number;
  blockedCount: number;
  failedCount: number;
  runningCount: number;
  totalCostUsd: number;
}

export interface TrialSummaryProviderBreakdownItem extends TrialSummaryTotals {
  provider: string;
  label: string;
}

export interface TrialSummaryModeBreakdownItem extends TrialSummaryTotals {
  mode: Mode;
  label: string;
}

export interface TrialSummaryHighlightItem {
  requestId: string;
  timestamp: string;
  eventType: RuntimeAuditEventType;
  status: RequestStatus;
  project: {
    id: string;
    name: string;
    slug: string | null;
  };
  mode: string;
  provider: string | null;
  model: string | null;
  message: string | null;
  errorCode: string | null;
  errorType: string | null;
  costTotalUsd: number | null;
}

export interface TrialSummary {
  window: TrialSummaryWindow;
  totals: TrialSummaryTotals;
  providerBreakdown: TrialSummaryProviderBreakdownItem[];
  modeBreakdown: TrialSummaryModeBreakdownItem[];
  highlights: TrialSummaryHighlightItem[];
}

export interface GetTrialSummaryInput {
  workspaceId: string;
  range?: TrialSummaryRange;
  now?: Date;
}

const DEFAULT_TRIAL_SUMMARY_RANGE: TrialSummaryRange = "30d";
const RANGE_DAY_COUNT: Record<TrialSummaryRange, number> = {
  "7d": 7,
  "30d": 30,
};
const NOT_ROUTED_PROVIDER_KEY = "not_routed";
const NOT_ROUTED_PROVIDER_LABEL = "Not routed";
const HIGHLIGHT_LIMIT = 5;

interface MutableAggregate extends TrialSummaryTotals {}

function createMutableAggregate(): MutableAggregate {
  return {
    requestCount: 0,
    succeededCount: 0,
    blockedCount: 0,
    failedCount: 0,
    runningCount: 0,
    totalCostUsd: 0,
  };
}

function addUsd(left: number, right: number) {
  return Number((left + right).toFixed(8));
}

function formatLabel(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/^\w/, (character) => character.toUpperCase());
}

function buildProviderLabel(provider: string) {
  switch (provider) {
    case "openai":
      return "OpenAI";
    case "anthropic":
      return "Anthropic";
    case NOT_ROUTED_PROVIDER_KEY:
      return NOT_ROUTED_PROVIDER_LABEL;
    default:
      return formatLabel(provider);
  }
}

function resolveWindow(input: {
  range: TrialSummaryRange;
  now: Date;
}): TrialSummaryWindow & { startDate: Date; endDate: Date } {
  const endDate = input.now;
  const startDate = new Date(
    endDate.getTime() - RANGE_DAY_COUNT[input.range] * 24 * 60 * 60 * 1000,
  );

  return {
    range: input.range,
    start: startDate.toISOString(),
    end: endDate.toISOString(),
    startDate,
    endDate,
  };
}

function applySummaryToAggregate(
  aggregate: MutableAggregate,
  summary: {
    status: RequestStatus;
    cost: { totalUsd: number | null } | null;
  },
) {
  aggregate.requestCount += 1;

  switch (summary.status) {
    case "succeeded":
      aggregate.succeededCount += 1;
      break;
    case "blocked":
      aggregate.blockedCount += 1;
      break;
    case "failed":
      aggregate.failedCount += 1;
      break;
    default:
      aggregate.runningCount += 1;
      break;
  }

  if (typeof summary.cost?.totalUsd === "number") {
    aggregate.totalCostUsd = addUsd(
      aggregate.totalCostUsd,
      summary.cost.totalUsd,
    );
  }
}

function sortProviderBreakdown(
  left: TrialSummaryProviderBreakdownItem,
  right: TrialSummaryProviderBreakdownItem,
) {
  if (left.provider === right.provider) {
    return 0;
  }

  if (left.provider === NOT_ROUTED_PROVIDER_KEY) {
    return 1;
  }

  if (right.provider === NOT_ROUTED_PROVIDER_KEY) {
    return -1;
  }

  const leftKnownIndex = PROVIDER_NAME_VALUES.indexOf(
    left.provider as (typeof PROVIDER_NAME_VALUES)[number],
  );
  const rightKnownIndex = PROVIDER_NAME_VALUES.indexOf(
    right.provider as (typeof PROVIDER_NAME_VALUES)[number],
  );
  const leftIsKnown = leftKnownIndex >= 0;
  const rightIsKnown = rightKnownIndex >= 0;

  if (leftIsKnown && rightIsKnown) {
    return leftKnownIndex - rightKnownIndex;
  }

  if (leftIsKnown) {
    return -1;
  }

  if (rightIsKnown) {
    return 1;
  }

  return (
    left.label.localeCompare(right.label) ||
    left.provider.localeCompare(right.provider)
  );
}

function sortModeBreakdown(
  left: TrialSummaryModeBreakdownItem,
  right: TrialSummaryModeBreakdownItem,
) {
  return MODE_VALUES.indexOf(left.mode) - MODE_VALUES.indexOf(right.mode);
}

export async function getTrialSummary(
  input: GetTrialSummaryInput,
  database?: Database,
): Promise<TrialSummary> {
  return withDatabase(database, async (db) => {
    const range = input.range ?? DEFAULT_TRIAL_SUMMARY_RANGE;
    const now = input.now ?? new Date();
    const window = resolveWindow({
      range,
      now,
    });
    const requestRows = await db.query.requests.findMany({
      where: (table, { and, eq, gte, lt }) =>
        and(
          eq(table.workspaceId, input.workspaceId),
          gte(table.startedAt, window.startDate),
          lt(table.startedAt, window.endDate),
        ),
      with: {
        project: true,
      },
      orderBy: (table, { desc }) => [desc(table.startedAt), desc(table.id)],
    });
    const requestIds = requestRows.map((row) => row.id);

    if (requestIds.length === 0) {
      return {
        window: {
          range: window.range,
          start: window.start,
          end: window.end,
        },
        totals: createMutableAggregate(),
        providerBreakdown: [],
        modeBreakdown: [],
        highlights: [],
      };
    }

    const [attemptRows, usageRows, auditRows] = await Promise.all([
      db.query.requestAttempts.findMany({
        where: (table, { inArray }) => inArray(table.requestId, requestIds),
        orderBy: (table, { desc }) => [
          desc(table.completedAt),
          desc(table.startedAt),
          desc(table.attemptNumber),
        ],
      }),
      db.query.usageRecords.findMany({
        where: (table, { inArray }) => inArray(table.requestId, requestIds),
        orderBy: (table, { desc }) => [desc(table.recordedAt), desc(table.id)],
      }),
      db.query.auditEvents.findMany({
        where: (table, { and, eq, inArray }) =>
          and(
            eq(table.workspaceId, input.workspaceId),
            eq(table.entityType, "request"),
            inArray(table.entityId, requestIds),
          ),
        with: {
          project: true,
        },
        orderBy: (table, { desc }) => [desc(table.createdAt), desc(table.id)],
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

    const totals = createMutableAggregate();
    const providerBreakdown = new Map<
      string,
      TrialSummaryProviderBreakdownItem
    >();
    const modeBreakdown = new Map<Mode, TrialSummaryModeBreakdownItem>();
    const highlights: TrialSummaryHighlightItem[] = [];

    for (const requestRow of requestRows as RequestRuntimeRequestRecord[]) {
      const summary = resolveRequestRuntimeSummary({
        requestRow,
        latestAttempt: latestAttemptByRequestId.get(requestRow.id) ?? null,
        usageRecord: latestUsageByRequestId.get(requestRow.id) ?? null,
        requestEvents: auditEventsByRequestId.get(requestRow.id) ?? [],
      });
      const providerKey = summary.provider ?? NOT_ROUTED_PROVIDER_KEY;
      const providerBucket = providerBreakdown.get(providerKey) ?? {
        provider: providerKey,
        label: buildProviderLabel(providerKey),
        ...createMutableAggregate(),
      };
      const modeKey = summary.mode as Mode;
      const modeBucket = modeBreakdown.get(modeKey) ?? {
        mode: modeKey,
        label: formatLabel(modeKey),
        ...createMutableAggregate(),
      };

      applySummaryToAggregate(totals, summary);
      applySummaryToAggregate(providerBucket, summary);
      applySummaryToAggregate(modeBucket, summary);

      providerBreakdown.set(providerKey, providerBucket);
      modeBreakdown.set(modeKey, modeBucket);

      if (summary.primaryOutcome) {
        highlights.push({
          requestId: summary.requestId,
          timestamp: summary.primaryOutcome.timestamp,
          eventType: summary.primaryOutcome.eventType,
          status: summary.status,
          project: summary.project,
          mode: summary.mode,
          provider: summary.provider,
          model: summary.model,
          message: summary.primaryOutcome.message,
          errorCode: summary.primaryOutcome.errorCode,
          errorType: summary.primaryOutcome.errorType,
          costTotalUsd: summary.cost?.totalUsd ?? null,
        });
      }
    }

    highlights.sort(
      (left, right) =>
        right.timestamp.localeCompare(left.timestamp) ||
        right.requestId.localeCompare(left.requestId),
    );

    return {
      window: {
        range: window.range,
        start: window.start,
        end: window.end,
      },
      totals,
      providerBreakdown: [...providerBreakdown.values()].sort(
        sortProviderBreakdown,
      ),
      modeBreakdown: [...modeBreakdown.values()].sort(sortModeBreakdown),
      highlights: highlights.slice(0, HIGHLIGHT_LIMIT),
    };
  });
}
