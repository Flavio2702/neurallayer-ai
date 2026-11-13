import { index, pgTable, text } from "drizzle-orm/pg-core";

import {
  createdAtColumn,
  idColumn,
  jsonObjectColumn,
  policyEnforcementModeEnum,
  policyRuleStatusEnum,
  policyRuleTypeEnum,
  updatedAtColumn,
} from "./common";
import { projects } from "./projects";
import { workspaces } from "./workspaces";

export const policyRules = pgTable(
  "policy_rules",
  {
    id: idColumn(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    projectId: text("project_id").references(() => projects.id),
    name: text("name").notNull(),
    ruleType: policyRuleTypeEnum("rule_type").notNull(),
    status: policyRuleStatusEnum("status").notNull().default("active"),
    enforcementMode: policyEnforcementModeEnum("enforcement_mode")
      .notNull()
      .default("hard_block"),
    conditionsJson:
      jsonObjectColumn<Record<string, unknown>>("conditions_json").notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => ({
    workspaceIdx: index("policy_rules_workspace_idx").on(table.workspaceId),
    projectIdx: index("policy_rules_project_idx").on(table.projectId),
    ruleTypeIdx: index("policy_rules_rule_type_idx").on(table.ruleType),
    statusIdx: index("policy_rules_status_idx").on(table.status),
  }),
);
