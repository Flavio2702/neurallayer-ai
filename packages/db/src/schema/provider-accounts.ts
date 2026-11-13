import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import {
  createdAtColumn,
  encryptedCredentialsColumn,
  idColumn,
  metadataColumn,
  providerAccountStatusEnum,
  providerNameEnum,
  updatedAtColumn,
} from "./common";
import { workspaces } from "./workspaces";

export const providerAccounts = pgTable(
  "provider_accounts",
  {
    id: idColumn(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    provider: providerNameEnum("provider").notNull(),
    displayName: text("display_name").notNull(),
    status: providerAccountStatusEnum("status").notNull().default("active"),
    encryptedCredentials: encryptedCredentialsColumn(),
    testStatus: text("test_status"),
    lastTestedAt: timestamp("last_tested_at", { withTimezone: true }),
    metadata: metadataColumn(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => ({
    workspaceProviderNameUnique: uniqueIndex(
      "provider_accounts_workspace_provider_name_unique",
    ).on(table.workspaceId, table.provider, table.displayName),
    workspaceIdx: index("provider_accounts_workspace_idx").on(
      table.workspaceId,
    ),
    workspaceProviderIdx: index("provider_accounts_workspace_provider_idx").on(
      table.workspaceId,
      table.provider,
    ),
    statusIdx: index("provider_accounts_status_idx").on(table.status),
  }),
);
