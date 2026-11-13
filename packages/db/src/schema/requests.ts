import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import {
  createdAtColumn,
  idColumn,
  jsonObjectColumn,
  modeEnum,
  requestSourceEnum,
  requestStatusEnum,
  taskTypeEnum,
  updatedAtColumn,
} from "./common";
import { gatewayApiKeys } from "./gateway-api-keys";
import { projects } from "./projects";
import { workspaces } from "./workspaces";

export const requests = pgTable(
  "requests",
  {
    id: idColumn(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    apiKeyId: text("api_key_id")
      .notNull()
      .references(() => gatewayApiKeys.id),
    source: requestSourceEnum("source").notNull().default("unknown"),
    mode: modeEnum("mode").notNull().default("balanced"),
    taskType: taskTypeEnum("task_type").notNull().default("general"),
    status: requestStatusEnum("status").notNull().default("pending"),
    clientRequestId: text("client_request_id"),
    normalizedRequestJson: jsonObjectColumn<Record<string, unknown>>(
      "normalized_request_json",
    ).notNull(),
    requestMetadata: jsonObjectColumn<Record<string, unknown> | null>(
      "request_metadata",
    ),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => ({
    workspaceIdx: index("requests_workspace_idx").on(table.workspaceId),
    projectIdx: index("requests_project_idx").on(table.projectId),
    apiKeyIdx: index("requests_api_key_idx").on(table.apiKeyId),
    statusIdx: index("requests_status_idx").on(table.status),
    modeIdx: index("requests_mode_idx").on(table.mode),
    taskTypeIdx: index("requests_task_type_idx").on(table.taskType),
    createdAtIdx: index("requests_created_at_idx").on(table.createdAt),
    workspaceCreatedAtIdx: index("requests_workspace_created_at_idx").on(
      table.workspaceId,
      table.createdAt,
    ),
  }),
);
