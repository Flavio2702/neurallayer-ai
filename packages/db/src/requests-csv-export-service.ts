import type { RequestStatus } from "@neuralayer/core";

import type { Database } from "./client";
import { withDatabase } from "./connection-helpers";
import {
  type RequestRuntimeAttemptRecord,
  type RequestRuntimeAuditEventRecord,
  type RequestRuntimeRequestRecord,
  type RequestRuntimeUsageRecord,
  resolveRequestRuntimeSummary,
} from "./request-runtime-lineage";
import type { TrialSummaryRange } from "./trial-summary-service";

const DEFAULT_TRIAL_SUMMARY_RANGE: TrialSummaryRange = "30d";
const RANGE_DAY_COUNT: Record<TrialSummaryRange, number> = {
  "7d": 7,
  "30d": 30,
};

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

export interface RequestsCsvExportWindow {
  range: TrialSummaryRange;
  start: string;
  end: string;
}

export interface RequestsCsvExportRow {
  timestamp: string;
  project: string;
  mode: string;
  provider: string;
  model: string;
  status: string;
  latency: string;
  usage: string;
  cost: string;
  selectionReason: string;
  issueSummary: string;
}

export interface RequestsCsvExport {
  window: RequestsCsvExportWindow;
  rows: RequestsCsvExportRow[];
}

export interface GetRequestsCsvExportInput {
  workspaceId: string;
  range?: TrialSummaryRange;
  now?: Date;
}

function formatLabel(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/^\w/, (char) => char.toUpperCase());
}

function formatProviderLabel(provider: string | null) {
  switch (provider) {
    case "openai":
      return "OpenAI";
    case "anthropic":
      return "Anthropic";
    default:
      return provider ? formatLabel(provider) : "No provider selected";
  }
}

function formatLatency(latencyMs: number | null) {
  if (typeof latencyMs !== "number" || !Number.isFinite(latencyMs)) {
    return "Not recorded yet";
  }

  if (latencyMs >= 1000) {
    const seconds = latencyMs / 1000;

    return `${seconds.toFixed(seconds % 1 === 0 ? 0 : 1)} s`;
  }

  return `${latencyMs} ms`;
}

function formatCompactNumber(value: number) {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatUsageSummary(
  input: {
    totalTokens: number | null;
    inputTokens: number | null;
    outputTokens: number | null;
  } | null,
) {
  if (!input) {
    return "Not recorded yet";
  }

  if (typeof input.totalTokens === "number") {
    return `${formatCompactNumber(input.totalTokens)} total tokens`;
  }

  if (
    typeof input.inputTokens === "number" &&
    typeof input.outputTokens === "number"
  ) {
    return `${formatCompactNumber(input.inputTokens)} in / ${formatCompactNumber(
      input.outputTokens,
    )} out`;
  }

  if (typeof input.inputTokens === "number") {
    return `${formatCompactNumber(input.inputTokens)} input tokens`;
  }

  if (typeof input.outputTokens === "number") {
    return `${formatCompactNumber(input.outputTokens)} output tokens`;
  }

  return "Not recorded yet";
}

function formatCostSummary(input: { totalUsd: number | null } | null) {
  return typeof input?.totalUsd === "number"
    ? currencyFormatter.format(input.totalUsd)
    : "Not recorded yet";
}

function getSelectionReasonText(input: {
  selectionReason: { text: string | null };
  status: RequestStatus;
  issue: { kind: "blocked" | "error"; text: string | null } | null;
}) {
  if (input.selectionReason.text) {
    return input.selectionReason.text;
  }

  if (input.status === "blocked") {
    return (
      input.issue?.text ??
      "This request was stopped before provider execution started."
    );
  }

  if (input.status === "failed") {
    return (
      input.issue?.text ??
      "The provider path failed after a routing decision was made."
    );
  }

  return "No routing explanation was recorded for this request.";
}

function formatIssueSummary(input: {
  kind: "blocked" | "error";
  code: string | null;
  type: string | null;
  text: string | null;
}) {
  const fallbackText =
    input.kind === "blocked"
      ? "This request was blocked before a provider call started."
      : "Provider execution failed after routing selected a path.";
  const metadata = [input.code, input.type]
    .filter((value): value is string => Boolean(value))
    .join(" / ");

  if (!metadata) {
    return input.text ?? fallbackText;
  }

  return `${input.text ?? fallbackText} (${metadata})`;
}

function resolveWindow(input: {
  range: TrialSummaryRange;
  now: Date;
}): RequestsCsvExportWindow & { startDate: Date; endDate: Date } {
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

export async function getRequestsCsvExport(
  input: GetRequestsCsvExportInput,
  database?: Database,
): Promise<RequestsCsvExport> {
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
        rows: [],
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

    return {
      window: {
        range: window.range,
        start: window.start,
        end: window.end,
      },
      rows: (requestRows as RequestRuntimeRequestRecord[]).map((requestRow) => {
        const summary = resolveRequestRuntimeSummary({
          requestRow,
          latestAttempt: latestAttemptByRequestId.get(requestRow.id) ?? null,
          usageRecord: latestUsageByRequestId.get(requestRow.id) ?? null,
          requestEvents: auditEventsByRequestId.get(requestRow.id) ?? [],
        });

        return {
          timestamp: summary.timestamp,
          project: summary.project.name,
          mode: formatLabel(summary.mode),
          provider: formatProviderLabel(summary.provider),
          model: summary.model ?? "No provider selected",
          status: formatLabel(summary.status),
          latency: formatLatency(summary.latencyMs),
          usage: formatUsageSummary(summary.usage),
          cost: formatCostSummary(summary.cost),
          selectionReason: getSelectionReasonText({
            selectionReason: summary.selectionReason,
            status: summary.status,
            issue: summary.issue,
          }),
          issueSummary: summary.issue ? formatIssueSummary(summary.issue) : "",
        };
      }),
    };
  });
}
