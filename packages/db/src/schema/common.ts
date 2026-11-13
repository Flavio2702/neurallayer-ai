import {
  ATTEMPT_STATUS_VALUES,
  AUDIT_ACTOR_TYPE_VALUES,
  BENCHMARK_SOURCE_NAME_VALUES,
  COST_TIER_VALUES,
  ERROR_TYPE_VALUES,
  LATENCY_TIER_VALUES,
  MODE_VALUES,
  POLICY_ENFORCEMENT_MODE_VALUES,
  PROVIDER_NAME_VALUES,
  REQUEST_SOURCE_VALUES,
  REQUEST_STATUS_VALUES,
  TASK_TYPE_VALUES,
} from "@neuralayer/core";
import { jsonb, numeric, pgEnum, text, timestamp } from "drizzle-orm/pg-core";

export const workspaceStatusEnum = pgEnum("workspace_status", [
  "active",
  "inactive",
]);
export const userStatusEnum = pgEnum("user_status", [
  "active",
  "invited",
  "disabled",
]);
export const membershipRoleEnum = pgEnum("membership_role", [
  "owner",
  "admin",
  "member",
]);
export const projectStatusEnum = pgEnum("project_status", [
  "active",
  "inactive",
]);
export const gatewayApiKeyStatusEnum = pgEnum("gateway_api_key_status", [
  "active",
  "revoked",
  "expired",
]);
export const providerAccountStatusEnum = pgEnum("provider_account_status", [
  "active",
  "inactive",
  "error",
]);
export const modelStatusEnum = pgEnum("model_status", [
  "active",
  "deprecated",
  "disabled",
]);
export const routingProfileStatusEnum = pgEnum("routing_profile_status", [
  "active",
  "inactive",
]);
export const policyRuleTypeEnum = pgEnum("policy_rule_type", [
  "allow_model",
  "deny_model",
  "allow_provider",
  "deny_provider",
  "budget_cap",
  "preferred_provider",
  "mode_model_mapping",
]);
export const policyRuleStatusEnum = pgEnum("policy_rule_status", [
  "active",
  "inactive",
]);
export const usageSourceEnum = pgEnum("usage_source", [
  "provider_reported",
  "estimated",
  "manual_adjustment",
]);
export const benchmarkSourceNameEnum = pgEnum("benchmark_source_name", [
  ...BENCHMARK_SOURCE_NAME_VALUES,
]);
export const modeEnum = pgEnum("mode", [...MODE_VALUES]);
export const providerNameEnum = pgEnum("provider_name", [
  ...PROVIDER_NAME_VALUES,
]);
export const requestSourceEnum = pgEnum("request_source", [
  ...REQUEST_SOURCE_VALUES,
]);
export const taskTypeEnum = pgEnum("task_type", [...TASK_TYPE_VALUES]);
export const requestStatusEnum = pgEnum("request_status", [
  ...REQUEST_STATUS_VALUES,
]);
export const attemptStatusEnum = pgEnum("attempt_status", [
  ...ATTEMPT_STATUS_VALUES,
]);
export const policyEnforcementModeEnum = pgEnum("policy_enforcement_mode", [
  ...POLICY_ENFORCEMENT_MODE_VALUES,
]);
export const costTierEnum = pgEnum("cost_tier", [...COST_TIER_VALUES]);
export const latencyTierEnum = pgEnum("latency_tier", [...LATENCY_TIER_VALUES]);
export const auditActorTypeEnum = pgEnum("audit_actor_type", [
  ...AUDIT_ACTOR_TYPE_VALUES,
]);
export const errorTypeEnum = pgEnum("error_type", [...ERROR_TYPE_VALUES]);

export const idColumn = (name = "id") => text(name).primaryKey();

export const jsonObjectColumn = <
  T extends Record<string, unknown> | null = Record<string, unknown> | null,
>(
  name: string,
) => jsonb(name).$type<T>();

export const metadataColumn = (name = "metadata") =>
  jsonObjectColumn<Record<string, unknown> | null>(name);

export const encryptedCredentialsColumn = () =>
  text("encrypted_credentials").notNull();

export const costNumericColumn = (name: string) =>
  numeric(name, { precision: 20, scale: 8 });

export const createdAtColumn = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const updatedAtColumn = () =>
  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();
