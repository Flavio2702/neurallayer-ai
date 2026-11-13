import { index, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";

import {
  createdAtColumn,
  idColumn,
  jsonObjectColumn,
  routingProfileStatusEnum,
  updatedAtColumn,
} from "./common";
import { workspaces } from "./workspaces";

export const routingProfiles = pgTable(
  "routing_profiles",
  {
    id: idColumn(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    status: routingProfileStatusEnum("status").notNull().default("active"),
    rulesJson:
      jsonObjectColumn<Record<string, unknown>>("rules_json").notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => ({
    workspaceSlugUnique: uniqueIndex(
      "routing_profiles_workspace_slug_unique",
    ).on(table.workspaceId, table.slug),
    workspaceIdx: index("routing_profiles_workspace_idx").on(table.workspaceId),
    statusIdx: index("routing_profiles_status_idx").on(table.status),
  }),
);
