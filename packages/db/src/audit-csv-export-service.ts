import {
  formatAuditErrorSummary,
  getAuditProjectLabel,
  normalizeAuditEventFields,
} from "./audit-event-summary";
import type { Database } from "./client";
import { withDatabase } from "./connection-helpers";
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

export interface AuditCsvExportWindow {
  range: TrialSummaryRange;
  start: string;
  end: string;
}

export interface AuditCsvExportRow {
  timestamp: string;
  eventType: string;
  entityType: string;
  entityId: string;
  project: string;
  actorType: string;
  requestStatus: string;
  provider: string;
  model: string;
  error: string;
  cost: string;
  message: string;
}

export interface AuditCsvExport {
  window: AuditCsvExportWindow;
  rows: AuditCsvExportRow[];
}

export interface GetAuditCsvExportInput {
  workspaceId: string;
  range?: TrialSummaryRange;
  now?: Date;
}

function resolveWindow(input: {
  range: TrialSummaryRange;
  now: Date;
}): AuditCsvExportWindow & { startDate: Date; endDate: Date } {
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

function formatCost(value: number | null) {
  return typeof value === "number" ? currencyFormatter.format(value) : "";
}

export async function getAuditCsvExport(
  input: GetAuditCsvExportInput,
  database?: Database,
): Promise<AuditCsvExport> {
  return withDatabase(database, async (db) => {
    const range = input.range ?? DEFAULT_TRIAL_SUMMARY_RANGE;
    const now = input.now ?? new Date();
    const window = resolveWindow({
      range,
      now,
    });
    const auditRows = await db.query.auditEvents.findMany({
      where: (table, { and, eq, gte, lt }) =>
        and(
          eq(table.workspaceId, input.workspaceId),
          gte(table.createdAt, window.startDate),
          lt(table.createdAt, window.endDate),
        ),
      with: {
        project: true,
      },
      orderBy: (table, { desc }) => [desc(table.createdAt), desc(table.id)],
    });

    return {
      window: {
        range: window.range,
        start: window.start,
        end: window.end,
      },
      rows: auditRows.map((row) => {
        const summary = normalizeAuditEventFields({
          eventType: row.eventType,
          eventPayload: row.eventPayload,
        });

        return {
          timestamp: row.createdAt.toISOString(),
          eventType: row.eventType,
          entityType: row.entityType,
          entityId: row.entityId,
          project: getAuditProjectLabel(row.project),
          actorType: row.actorType,
          requestStatus: summary.requestStatus ?? "",
          provider: summary.provider ?? "",
          model: summary.model ?? "",
          error: formatAuditErrorSummary({
            errorCode: summary.errorCode,
            errorType: summary.errorType,
          }),
          cost: formatCost(summary.costTotalUsd),
          message: summary.message ?? "",
        } satisfies AuditCsvExportRow;
      }),
    };
  });
}
