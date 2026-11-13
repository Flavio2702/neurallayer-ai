import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import {
  attemptStatusEnum,
  createdAtColumn,
  errorTypeEnum,
  idColumn,
  jsonObjectColumn,
  providerNameEnum,
  updatedAtColumn,
} from "./common";
import { modelCatalog } from "./model-catalog";
import { projects } from "./projects";
import { providerAccounts } from "./provider-accounts";
import { requests } from "./requests";
import { workspaces } from "./workspaces";

export const requestAttempts = pgTable(
  "request_attempts",
  {
    id: idColumn(),
    requestId: text("request_id")
      .notNull()
      .references(() => requests.id),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    providerAccountId: text("provider_account_id")
      .notNull()
      .references(() => providerAccounts.id),
    provider: providerNameEnum("provider").notNull(),
    modelCatalogId: text("model_catalog_id").references(() => modelCatalog.id),
    modelId: text("model_id").notNull(),
    attemptNumber: integer("attempt_number").notNull(),
    selectionReason: text("selection_reason"),
    status: attemptStatusEnum("status").notNull().default("pending"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    latencyMs: integer("latency_ms"),
    errorType: errorTypeEnum("error_type"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    providerRequestId: text("provider_request_id"),
    providerResponseMetadata: jsonObjectColumn<Record<string, unknown> | null>(
      "provider_response_metadata",
    ),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => ({
    requestAttemptNumberUnique: uniqueIndex(
      "request_attempts_request_attempt_number_unique",
    ).on(table.requestId, table.attemptNumber),
    requestIdx: index("request_attempts_request_idx").on(table.requestId),
    workspaceIdx: index("request_attempts_workspace_idx").on(table.workspaceId),
    projectIdx: index("request_attempts_project_idx").on(table.projectId),
    providerIdx: index("request_attempts_provider_idx").on(table.provider),
    statusIdx: index("request_attempts_status_idx").on(table.status),
    createdAtIdx: index("request_attempts_created_at_idx").on(table.createdAt),
  }),
);
