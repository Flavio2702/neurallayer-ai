import type { CapabilityClass } from "@neuralayer/core";

import {
  boolean,
  index,
  pgTable,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import {
  costTierEnum,
  createdAtColumn,
  idColumn,
  latencyTierEnum,
  metadataColumn,
  modelStatusEnum,
  providerNameEnum,
  updatedAtColumn,
} from "./common";

export const modelCatalog = pgTable(
  "model_catalog",
  {
    id: idColumn(),
    provider: providerNameEnum("provider").notNull(),
    modelId: text("model_id").notNull(),
    label: text("label").notNull(),
    status: modelStatusEnum("status").notNull().default("active"),
    isActive: boolean("is_active").notNull().default(true),
    supportsChat: boolean("supports_chat").notNull(),
    supportsStreaming: boolean("supports_streaming").notNull(),
    capabilityClasses: text("capability_classes")
      .array()
      .$type<CapabilityClass[]>()
      .notNull(),
    costTier: costTierEnum("cost_tier").notNull(),
    latencyTier: latencyTierEnum("latency_tier").notNull(),
    metadata: metadataColumn(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => ({
    providerModelUnique: uniqueIndex("model_catalog_provider_model_unique").on(
      table.provider,
      table.modelId,
    ),
    providerIdx: index("model_catalog_provider_idx").on(table.provider),
    isActiveIdx: index("model_catalog_is_active_idx").on(table.isActive),
    statusIdx: index("model_catalog_status_idx").on(table.status),
  }),
);
