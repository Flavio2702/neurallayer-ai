import { index, pgTable, text } from "drizzle-orm/pg-core";

import {
  auditActorTypeEnum,
  createdAtColumn,
  idColumn,
  jsonObjectColumn,
} from "./common";
import { gatewayApiKeys } from "./gateway-api-keys";
import { projects } from "./projects";
import { users } from "./users";
import { workspaces } from "./workspaces";

export const auditEvents = pgTable(
  "audit_events",
  {
    id: idColumn(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    projectId: text("project_id").references(() => projects.id),
    actorType: auditActorTypeEnum("actor_type").notNull().default("system"),
    actorUserId: text("actor_user_id").references(() => users.id),
    actorApiKeyId: text("actor_api_key_id").references(() => gatewayApiKeys.id),
    eventType: text("event_type").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    eventPayload:
      jsonObjectColumn<Record<string, unknown>>("event_payload").notNull(),
    createdAt: createdAtColumn(),
  },
  (table) => ({
    workspaceIdx: index("audit_events_workspace_idx").on(table.workspaceId),
    projectIdx: index("audit_events_project_idx").on(table.projectId),
    eventTypeIdx: index("audit_events_event_type_idx").on(table.eventType),
    entityIdx: index("audit_events_entity_idx").on(
      table.entityType,
      table.entityId,
    ),
    createdAtIdx: index("audit_events_created_at_idx").on(table.createdAt),
  }),
);
