ALTER TABLE "external_model_benchmarks" ADD COLUMN "model_mapping_key" text;--> statement-breakpoint
UPDATE "external_model_benchmarks"
SET "model_mapping_key" = "provider"::text || ':' || "model_id"
WHERE "model_mapping_key" IS NULL;--> statement-breakpoint
ALTER TABLE "external_model_benchmarks" ALTER COLUMN "model_mapping_key" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "external_model_benchmarks_source_model_mapping_key_unique" ON "external_model_benchmarks" USING btree ("source_name","model_mapping_key");
