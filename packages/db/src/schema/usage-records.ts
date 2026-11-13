import { index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import {
  costNumericColumn,
  createdAtColumn,
  idColumn,
  providerNameEnum,
  updatedAtColumn,
  usageSourceEnum,
} from "./common";
import { projects } from "./projects";
import { requestAttempts } from "./request-attempts";
import { requests } from "./requests";
import { workspaces } from "./workspaces";

export const usageRecords = pgTable(
  "usage_records",
  {
    id: idColumn(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    requestId: text("request_id")
      .notNull()
      .references(() => requests.id),
    attemptId: text("attempt_id")
      .notNull()
      .references(() => requestAttempts.id),
    provider: providerNameEnum("provider").notNull(),
    modelId: text("model_id").notNull(),
    usageSource: usageSourceEnum("usage_source")
      .notNull()
      .default("provider_reported"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    totalTokens: integer("total_tokens"),
    costInput: costNumericColumn("cost_input"),
    costOutput: costNumericColumn("cost_output"),
    costTotal: costNumericColumn("cost_total"),
    currency: text("currency").notNull().default("USD"),
    pricingVersion: text("pricing_version"),
    recordedAt: timestamp("recorded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => ({
    workspaceIdx: index("usage_records_workspace_idx").on(table.workspaceId),
    projectIdx: index("usage_records_project_idx").on(table.projectId),
    requestIdx: index("usage_records_request_idx").on(table.requestId),
    attemptIdx: index("usage_records_attempt_idx").on(table.attemptId),
    providerIdx: index("usage_records_provider_idx").on(table.provider),
    modelIdIdx: index("usage_records_model_id_idx").on(table.modelId),
    recordedAtIdx: index("usage_records_recorded_at_idx").on(table.recordedAt),
    workspaceRecordedAtIdx: index("usage_records_workspace_recorded_at_idx").on(
      table.workspaceId,
      table.recordedAt,
    ),
  }),
);
