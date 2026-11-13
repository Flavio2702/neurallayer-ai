import { pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import {
  createdAtColumn,
  idColumn,
  updatedAtColumn,
  userStatusEnum,
} from "./common";

export const users = pgTable(
  "users",
  {
    id: idColumn(),
    email: text("email").notNull(),
    fullName: text("full_name"),
    status: userStatusEnum("status").notNull().default("invited"),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => ({
    emailUnique: uniqueIndex("users_email_unique").on(table.email),
  }),
);
