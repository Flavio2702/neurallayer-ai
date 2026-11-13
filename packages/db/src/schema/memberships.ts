import { index, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";

import {
  createdAtColumn,
  idColumn,
  membershipRoleEnum,
  updatedAtColumn,
} from "./common";
import { users } from "./users";
import { workspaces } from "./workspaces";

export const memberships = pgTable(
  "memberships",
  {
    id: idColumn(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    role: membershipRoleEnum("role").notNull().default("member"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => ({
    workspaceUserUnique: uniqueIndex("memberships_workspace_user_unique").on(
      table.workspaceId,
      table.userId,
    ),
    workspaceIdx: index("memberships_workspace_idx").on(table.workspaceId),
    userIdx: index("memberships_user_idx").on(table.userId),
  }),
);
