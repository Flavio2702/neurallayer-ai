import { index, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";

import {
  createdAtColumn,
  idColumn,
  metadataColumn,
  modeEnum,
  updatedAtColumn,
  workspaceStatusEnum,
} from "./common";

export const workspaces = pgTable(
  "workspaces",
  {
    id: idColumn(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    status: workspaceStatusEnum("status").notNull().default("active"),
    defaultMode: modeEnum("default_mode").notNull().default("balanced"),
    defaultRoutingProfileId: text("default_routing_profile_id"),
    metadata: metadataColumn(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => ({
    slugUnique: uniqueIndex("workspaces_slug_unique").on(table.slug),
    statusIdx: index("workspaces_status_idx").on(table.status),
  }),
);
