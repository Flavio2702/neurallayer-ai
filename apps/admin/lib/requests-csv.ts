import type { RequestsCsvExportRow, TrialSummaryRange } from "@neuralayer/db";

const REQUESTS_CSV_HEADERS = [
  "Timestamp",
  "Project",
  "Mode",
  "Provider",
  "Model",
  "Status",
  "Latency",
  "Usage",
  "Cost",
  "Selection reason",
  "Issue summary",
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

export function serializeRequestsCsv(rows: RequestsCsvExportRow[]) {
  const lines = [
    REQUESTS_CSV_HEADERS.join(","),
    ...rows.map((row) =>
      [
        row.timestamp,
        row.project,
        row.mode,
        row.provider,
        row.model,
        row.status,
        row.latency,
        row.usage,
        row.cost,
        row.selectionReason,
        row.issueSummary,
      ]
        .map((value) => escapeCsvValue(value))
        .join(","),
    ),
  ];

  return lines.join("\r\n");
}

export function buildRequestsCsvFilename(input: {
  workspaceSlug: string;
  range: TrialSummaryRange;
  exportedAt?: Date;
}) {
  const exportedAt = input.exportedAt ?? new Date();
  const exportDate = exportedAt.toISOString().slice(0, 10);

  return `requests-${input.workspaceSlug}-${input.range}-${exportDate}.csv`;
}
