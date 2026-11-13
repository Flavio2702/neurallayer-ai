import type { AuditCsvExportRow, TrialSummaryRange } from "@neuralayer/db";

const AUDIT_CSV_HEADERS = [
  "Timestamp",
  "Event type",
  "Entity type",
  "Entity id",
  "Project",
  "Actor type",
  "Request status",
  "Provider",
  "Model",
  "Error",
  "Cost",
  "Message",
] as const;

function escapeCsvValue(value: string) {
  if (
    value.includes(",") ||
    value.includes('"') ||
    value.includes("\n") ||
    value.includes("\r")
  ) {
    return `"${value.replaceAll('"', '""')}"`;
  }

  return value;
}

export function serializeAuditCsv(rows: AuditCsvExportRow[]) {
  const lines = [
    AUDIT_CSV_HEADERS.join(","),
    ...rows.map((row) =>
      [
        row.timestamp,
        row.eventType,
        row.entityType,
        row.entityId,
        row.project,
        row.actorType,
        row.requestStatus,
        row.provider,
        row.model,
        row.error,
        row.cost,
        row.message,
      ]
        .map((value) => escapeCsvValue(value))
        .join(","),
    ),
  ];

  return lines.join("\r\n");
}

export function buildAuditCsvFilename(input: {
  workspaceSlug: string;
  range: TrialSummaryRange;
  exportedAt?: Date;
}) {
  const exportedAt = input.exportedAt ?? new Date();
  const exportDate = exportedAt.toISOString().slice(0, 10);

  return `audit-${input.workspaceSlug}-${input.range}-${exportDate}.csv`;
}
