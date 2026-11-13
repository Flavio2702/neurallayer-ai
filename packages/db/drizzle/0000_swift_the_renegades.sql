CREATE TYPE "public"."attempt_status" AS ENUM('pending', 'running', 'succeeded', 'failed', 'timeout', 'blocked');--> statement-breakpoint
CREATE TYPE "public"."audit_actor_type" AS ENUM('system', 'user', 'api_key');--> statement-breakpoint
CREATE TYPE "public"."cost_tier" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TYPE "public"."error_type" AS ENUM('auth_error', 'forbidden', 'invalid_request', 'policy_blocked', 'rate_limit', 'quota_exceeded', 'provider_unavailable', 'timeout', 'not_supported', 'internal_error');--> statement-breakpoint
CREATE TYPE "public"."gateway_api_key_status" AS ENUM('active', 'revoked', 'expired');--> statement-breakpoint
CREATE TYPE "public"."latency_tier" AS ENUM('fast', 'medium', 'slow');--> statement-breakpoint
CREATE TYPE "public"."membership_role" AS ENUM('owner', 'admin', 'member');--> statement-breakpoint
CREATE TYPE "public"."mode" AS ENUM('max_quality', 'balanced', 'budget');--> statement-breakpoint
CREATE TYPE "public"."model_status" AS ENUM('active', 'deprecated', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."policy_enforcement_mode" AS ENUM('hard_block', 'soft_warn');--> statement-breakpoint
CREATE TYPE "public"."policy_rule_status" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TYPE "public"."policy_rule_type" AS ENUM('allow_model', 'deny_model', 'allow_provider', 'deny_provider', 'budget_cap', 'preferred_provider', 'mode_model_mapping');--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TYPE "public"."provider_account_status" AS ENUM('active', 'inactive', 'error');--> statement-breakpoint
CREATE TYPE "public"."provider_name" AS ENUM('openai', 'anthropic');--> statement-breakpoint
CREATE TYPE "public"."request_source" AS ENUM('api', 'cli', 'vscode_extension', 'dashboard', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."request_status" AS ENUM('pending', 'running', 'succeeded', 'failed', 'blocked');--> statement-breakpoint
CREATE TYPE "public"."routing_profile_status" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TYPE "public"."task_type" AS ENUM('general', 'code_generation', 'code_review', 'debugging', 'documentation');--> statement-breakpoint
CREATE TYPE "public"."usage_source" AS ENUM('provider_reported', 'estimated', 'manual_adjustment');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('active', 'invited', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."workspace_status" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audit_events" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text,
	"actor_type" "audit_actor_type" DEFAULT 'system' NOT NULL,
	"actor_user_id" text,
	"actor_api_key_id" text,
	"event_type" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"event_payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "gateway_api_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text,
	"name" text NOT NULL,
	"key_prefix" text NOT NULL,
	"key_hash" text NOT NULL,
	"status" "gateway_api_key_status" DEFAULT 'active' NOT NULL,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "memberships" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" "membership_role" DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "model_catalog" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" "provider_name" NOT NULL,
	"model_id" text NOT NULL,
	"label" text NOT NULL,
	"status" "model_status" DEFAULT 'active' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"supports_chat" boolean NOT NULL,
	"supports_streaming" boolean NOT NULL,
	"capability_classes" text[] NOT NULL,
	"cost_tier" "cost_tier" NOT NULL,
	"latency_tier" "latency_tier" NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "policy_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text,
	"name" text NOT NULL,
	"rule_type" "policy_rule_type" NOT NULL,
	"status" "policy_rule_status" DEFAULT 'active' NOT NULL,
	"enforcement_mode" "policy_enforcement_mode" DEFAULT 'hard_block' NOT NULL,
	"conditions_json" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "projects" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"status" "project_status" DEFAULT 'active' NOT NULL,
	"default_mode" "mode",
	"routing_profile_id" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "provider_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"provider" "provider_name" NOT NULL,
	"display_name" text NOT NULL,
	"status" "provider_account_status" DEFAULT 'active' NOT NULL,
	"encrypted_credentials" text NOT NULL,
	"test_status" text,
	"last_tested_at" timestamp with time zone,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "request_attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"provider" "provider_name" NOT NULL,
	"model_catalog_id" text,
	"model_id" text NOT NULL,
	"attempt_number" integer NOT NULL,
	"selection_reason" text,
	"status" "attempt_status" DEFAULT 'pending' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"latency_ms" integer,
	"error_type" "error_type",
	"error_code" text,
	"error_message" text,
	"provider_request_id" text,
	"provider_response_metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "requests" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text NOT NULL,
	"api_key_id" text NOT NULL,
	"source" "request_source" DEFAULT 'unknown' NOT NULL,
	"mode" "mode" DEFAULT 'balanced' NOT NULL,
	"task_type" "task_type" DEFAULT 'general' NOT NULL,
	"status" "request_status" DEFAULT 'pending' NOT NULL,
	"client_request_id" text,
	"normalized_request_json" jsonb NOT NULL,
	"request_metadata" jsonb,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "routing_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"status" "routing_profile_status" DEFAULT 'active' NOT NULL,
	"rules_json" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "usage_records" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text NOT NULL,
	"request_id" text NOT NULL,
	"attempt_id" text NOT NULL,
	"provider" "provider_name" NOT NULL,
	"model_id" text NOT NULL,
	"usage_source" "usage_source" DEFAULT 'provider_reported' NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"total_tokens" integer,
	"cost_input" numeric(20, 8),
	"cost_output" numeric(20, 8),
	"cost_total" numeric(20, 8),
	"currency" text DEFAULT 'USD' NOT NULL,
	"pricing_version" text,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"full_name" text,
	"status" "user_status" DEFAULT 'invited' NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workspaces" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"status" "workspace_status" DEFAULT 'active' NOT NULL,
	"default_mode" "mode" DEFAULT 'balanced' NOT NULL,
	"default_routing_profile_id" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_api_key_id_gateway_api_keys_id_fk" FOREIGN KEY ("actor_api_key_id") REFERENCES "public"."gateway_api_keys"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gateway_api_keys" ADD CONSTRAINT "gateway_api_keys_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gateway_api_keys" ADD CONSTRAINT "gateway_api_keys_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gateway_api_keys" ADD CONSTRAINT "gateway_api_keys_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "memberships" ADD CONSTRAINT "memberships_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "policy_rules" ADD CONSTRAINT "policy_rules_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "policy_rules" ADD CONSTRAINT "policy_rules_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "projects" ADD CONSTRAINT "projects_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "projects" ADD CONSTRAINT "projects_routing_profile_id_routing_profiles_id_fk" FOREIGN KEY ("routing_profile_id") REFERENCES "public"."routing_profiles"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "provider_accounts" ADD CONSTRAINT "provider_accounts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "request_attempts" ADD CONSTRAINT "request_attempts_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."requests"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "request_attempts" ADD CONSTRAINT "request_attempts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "request_attempts" ADD CONSTRAINT "request_attempts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "request_attempts" ADD CONSTRAINT "request_attempts_provider_account_id_provider_accounts_id_fk" FOREIGN KEY ("provider_account_id") REFERENCES "public"."provider_accounts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "request_attempts" ADD CONSTRAINT "request_attempts_model_catalog_id_model_catalog_id_fk" FOREIGN KEY ("model_catalog_id") REFERENCES "public"."model_catalog"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "requests" ADD CONSTRAINT "requests_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "requests" ADD CONSTRAINT "requests_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "requests" ADD CONSTRAINT "requests_api_key_id_gateway_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."gateway_api_keys"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "routing_profiles" ADD CONSTRAINT "routing_profiles_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."requests"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_attempt_id_request_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."request_attempts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_events_workspace_idx" ON "audit_events" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_events_project_idx" ON "audit_events" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_events_event_type_idx" ON "audit_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_events_entity_idx" ON "audit_events" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_events_created_at_idx" ON "audit_events" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "gateway_api_keys_key_hash_unique" ON "gateway_api_keys" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gateway_api_keys_key_prefix_idx" ON "gateway_api_keys" USING btree ("key_prefix");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gateway_api_keys_workspace_idx" ON "gateway_api_keys" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gateway_api_keys_project_idx" ON "gateway_api_keys" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gateway_api_keys_status_idx" ON "gateway_api_keys" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "memberships_workspace_user_unique" ON "memberships" USING btree ("workspace_id","user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memberships_workspace_idx" ON "memberships" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memberships_user_idx" ON "memberships" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "model_catalog_provider_model_unique" ON "model_catalog" USING btree ("provider","model_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "model_catalog_provider_idx" ON "model_catalog" USING btree ("provider");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "model_catalog_is_active_idx" ON "model_catalog" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "model_catalog_status_idx" ON "model_catalog" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "policy_rules_workspace_idx" ON "policy_rules" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "policy_rules_project_idx" ON "policy_rules" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "policy_rules_rule_type_idx" ON "policy_rules" USING btree ("rule_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "policy_rules_status_idx" ON "policy_rules" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "projects_workspace_slug_unique" ON "projects" USING btree ("workspace_id","slug");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "projects_workspace_idx" ON "projects" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "projects_workspace_status_idx" ON "projects" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "provider_accounts_workspace_provider_name_unique" ON "provider_accounts" USING btree ("workspace_id","provider","display_name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "provider_accounts_workspace_idx" ON "provider_accounts" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "provider_accounts_workspace_provider_idx" ON "provider_accounts" USING btree ("workspace_id","provider");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "provider_accounts_status_idx" ON "provider_accounts" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "request_attempts_request_attempt_number_unique" ON "request_attempts" USING btree ("request_id","attempt_number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "request_attempts_request_idx" ON "request_attempts" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "request_attempts_workspace_idx" ON "request_attempts" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "request_attempts_project_idx" ON "request_attempts" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "request_attempts_provider_idx" ON "request_attempts" USING btree ("provider");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "request_attempts_status_idx" ON "request_attempts" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "request_attempts_created_at_idx" ON "request_attempts" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "requests_workspace_idx" ON "requests" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "requests_project_idx" ON "requests" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "requests_api_key_idx" ON "requests" USING btree ("api_key_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "requests_status_idx" ON "requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "requests_mode_idx" ON "requests" USING btree ("mode");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "requests_task_type_idx" ON "requests" USING btree ("task_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "requests_created_at_idx" ON "requests" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "requests_workspace_created_at_idx" ON "requests" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "routing_profiles_workspace_slug_unique" ON "routing_profiles" USING btree ("workspace_id","slug");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "routing_profiles_workspace_idx" ON "routing_profiles" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "routing_profiles_status_idx" ON "routing_profiles" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "usage_records_workspace_idx" ON "usage_records" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "usage_records_project_idx" ON "usage_records" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "usage_records_request_idx" ON "usage_records" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "usage_records_attempt_idx" ON "usage_records" USING btree ("attempt_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "usage_records_provider_idx" ON "usage_records" USING btree ("provider");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "usage_records_model_id_idx" ON "usage_records" USING btree ("model_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "usage_records_recorded_at_idx" ON "usage_records" USING btree ("recorded_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "usage_records_workspace_recorded_at_idx" ON "usage_records" USING btree ("workspace_id","recorded_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "users_email_unique" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "workspaces_slug_unique" ON "workspaces" USING btree ("slug");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workspaces_status_idx" ON "workspaces" USING btree ("status");