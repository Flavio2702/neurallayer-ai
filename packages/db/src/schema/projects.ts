import { index, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";

import {
  createdAtColumn,
  idColumn,
  metadataColumn,
  modeEnum,
  projectStatusEnum,
  updatedAtColumn,
} from "./common";
import { routingProfiles } from "./routing-profiles";
import { workspaces } from "./workspaces";

export const projects = pgTable(
  "projects",
  {
    id: idColumn(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    status: projectStatusEnum("status").notNull().default("active"),
    defaultMode: modeEnum("default_mode"),
    routingProfileId: text("routing_profile_id").references(
      () => routingProfiles.id,
    ),
    metadata: metadataColumn(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => ({
    workspaceSlugUnique: uniqueIndex("projects_workspace_slug_unique").on(
      table.workspaceId,
      table.slug,
    ),
    workspaceIdx: index("projects_workspace_idx").on(table.workspaceId),
    workspaceStatusIdx: index("projects_workspace_status_idx").on(
      table.workspaceId,
      table.status,
    ),
  }),
);
