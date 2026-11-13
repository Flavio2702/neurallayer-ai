import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import {
  createdAtColumn,
  gatewayApiKeyStatusEnum,
  idColumn,
  updatedAtColumn,
} from "./common";
import { projects } from "./projects";
import { users } from "./users";
import { workspaces } from "./workspaces";

export const gatewayApiKeys = pgTable(
  "gateway_api_keys",
  {
    id: idColumn(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    projectId: text("project_id").references(() => projects.id),
    name: text("name").notNull(),
    keyPrefix: text("key_prefix").notNull(),
    keyHash: text("key_hash").notNull(),
    status: gatewayApiKeyStatusEnum("status").notNull().default("active"),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdByUserId: text("created_by_user_id").references(() => users.id),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => ({
    keyHashUnique: uniqueIndex("gateway_api_keys_key_hash_unique").on(
      table.keyHash,
    ),
    keyPrefixIdx: index("gateway_api_keys_key_prefix_idx").on(table.keyPrefix),
    workspaceIdx: index("gateway_api_keys_workspace_idx").on(table.workspaceId),
    projectIdx: index("gateway_api_keys_project_idx").on(table.projectId),
    statusIdx: index("gateway_api_keys_status_idx").on(table.status),
  }),
);
