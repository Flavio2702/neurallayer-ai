CREATE TYPE "public"."benchmark_source_name" AS ENUM('artificial_analysis');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "external_model_benchmarks" (
	"id" text PRIMARY KEY NOT NULL,
	"source_name" "benchmark_source_name" NOT NULL,
	"external_stable_model_id" text NOT NULL,
	"model_catalog_id" text NOT NULL,
	"provider" "provider_name" NOT NULL,
	"model_id" text NOT NULL,
	"quality_general_score" numeric(10, 4),
	"quality_coding_score" numeric(10, 4),
	"price_input_per_1m_tokens_usd" numeric(20, 8),
	"price_output_per_1m_tokens_usd" numeric(20, 8),
	"output_tokens_per_second" numeric(12, 4),
	"time_to_first_token_ms" numeric(12, 4),
	"synced_at" timestamp with time zone NOT NULL,
	"raw_payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "external_model_benchmarks" ADD CONSTRAINT "external_model_benchmarks_model_catalog_id_model_catalog_id_fk" FOREIGN KEY ("model_catalog_id") REFERENCES "public"."model_catalog"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "external_model_benchmarks_source_model_catalog_unique" ON "external_model_benchmarks" USING btree ("source_name","model_catalog_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "external_model_benchmarks_source_external_model_unique" ON "external_model_benchmarks" USING btree ("source_name","external_stable_model_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "external_model_benchmarks_provider_idx" ON "external_model_benchmarks" USING btree ("provider");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "external_model_benchmarks_model_id_idx" ON "external_model_benchmarks" USING btree ("model_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "external_model_benchmarks_synced_at_idx" ON "external_model_benchmarks" USING btree ("synced_at");