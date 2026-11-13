import type { JsonObject } from "@neuralayer/core";

import {
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import {
  benchmarkSourceNameEnum,
  createdAtColumn,
  idColumn,
  jsonObjectColumn,
  providerNameEnum,
  updatedAtColumn,
} from "./common";
import { modelCatalog } from "./model-catalog";

export const externalModelBenchmarks = pgTable(
  "external_model_benchmarks",
  {
    id: idColumn(),
    sourceName: benchmarkSourceNameEnum("source_name").notNull(),
    externalStableModelId: text("external_stable_model_id").notNull(),
    modelMappingKey: text("model_mapping_key").notNull(),
    modelCatalogId: text("model_catalog_id")
      .notNull()
      .references(() => modelCatalog.id),
    provider: providerNameEnum("provider").notNull(),
    modelId: text("model_id").notNull(),
    qualityGeneralScore: numeric("quality_general_score", {
      precision: 10,
      scale: 4,
    }),
    qualityCodingScore: numeric("quality_coding_score", {
      precision: 10,
      scale: 4,
    }),
    priceInputPer1mTokensUsd: numeric("price_input_per_1m_tokens_usd", {
      precision: 20,
      scale: 8,
    }),
    priceOutputPer1mTokensUsd: numeric("price_output_per_1m_tokens_usd", {
      precision: 20,
      scale: 8,
    }),
    outputTokensPerSecond: numeric("output_tokens_per_second", {
      precision: 12,
      scale: 4,
    }),
    timeToFirstTokenMs: numeric("time_to_first_token_ms", {
      precision: 12,
      scale: 4,
    }),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull(),
    rawPayload: jsonObjectColumn<JsonObject | null>("raw_payload"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => ({
    sourceModelCatalogUnique: uniqueIndex(
      "external_model_benchmarks_source_model_catalog_unique",
    ).on(table.sourceName, table.modelCatalogId),
    sourceExternalStableModelUnique: uniqueIndex(
      "external_model_benchmarks_source_external_model_unique",
    ).on(table.sourceName, table.externalStableModelId),
    sourceModelMappingKeyUnique: uniqueIndex(
      "external_model_benchmarks_source_model_mapping_key_unique",
    ).on(table.sourceName, table.modelMappingKey),
    providerIdx: index("external_model_benchmarks_provider_idx").on(
      table.provider,
    ),
    modelIdIdx: index("external_model_benchmarks_model_id_idx").on(
      table.modelId,
    ),
    syncedAtIdx: index("external_model_benchmarks_synced_at_idx").on(
      table.syncedAt,
    ),
  }),
);
