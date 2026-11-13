import type { ProviderName } from "@neuralayer/core";

import type { SQL } from "drizzle-orm";
import { and, asc, eq } from "drizzle-orm";

import type { Database } from "./client";
import { withDatabase } from "./connection-helpers";
import { externalModelBenchmarks, modelCatalog } from "./schema";

export interface ListModelCatalogFilters {
  provider?: ProviderName;
  isActive?: boolean;
  status?: (typeof modelCatalog.$inferSelect)["status"];
}

export interface ListModelCatalogWithBenchmarksFilters {
  sourceName: (typeof externalModelBenchmarks.$inferSelect)["sourceName"];
  provider?: ProviderName;
  isActive?: boolean;
  status?: (typeof modelCatalog.$inferSelect)["status"];
}

export async function listModelCatalog(
  filters: ListModelCatalogFilters = {},
  database?: Database,
) {
  return withDatabase(database, async (db) => {
    const conditions: SQL[] = [];
    const shouldDefaultToActiveCatalog =
      typeof filters.isActive !== "boolean" &&
      typeof filters.status === "undefined";

    if (filters.provider) {
      conditions.push(eq(modelCatalog.provider, filters.provider));
    }

    if (typeof filters.isActive === "boolean") {
      conditions.push(eq(modelCatalog.isActive, filters.isActive));
    } else if (shouldDefaultToActiveCatalog) {
      conditions.push(eq(modelCatalog.isActive, true));
    }

    if (filters.status) {
      conditions.push(eq(modelCatalog.status, filters.status));
    } else if (shouldDefaultToActiveCatalog) {
      conditions.push(eq(modelCatalog.status, "active"));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    const baseQuery = db.select().from(modelCatalog);

    if (whereClause) {
      return baseQuery
        .where(whereClause)
        .orderBy(
          asc(modelCatalog.provider),
          asc(modelCatalog.label),
          asc(modelCatalog.modelId),
        );
    }

    return baseQuery.orderBy(
      asc(modelCatalog.provider),
      asc(modelCatalog.label),
      asc(modelCatalog.modelId),
    );
  });
}

export async function listModelCatalogWithBenchmarks(
  filters: ListModelCatalogWithBenchmarksFilters,
  database?: Database,
) {
  return withDatabase(database, async (db) => {
    const conditions: SQL[] = [];
    const shouldDefaultToActiveCatalog =
      typeof filters.isActive !== "boolean" &&
      typeof filters.status === "undefined";

    if (filters.provider) {
      conditions.push(eq(modelCatalog.provider, filters.provider));
    }

    if (typeof filters.isActive === "boolean") {
      conditions.push(eq(modelCatalog.isActive, filters.isActive));
    } else if (shouldDefaultToActiveCatalog) {
      conditions.push(eq(modelCatalog.isActive, true));
    }

    if (filters.status) {
      conditions.push(eq(modelCatalog.status, filters.status));
    } else if (shouldDefaultToActiveCatalog) {
      conditions.push(eq(modelCatalog.status, "active"));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    const baseQuery = db
      .select({
        model: modelCatalog,
        benchmark: externalModelBenchmarks,
      })
      .from(modelCatalog)
      .leftJoin(
        externalModelBenchmarks,
        and(
          eq(externalModelBenchmarks.modelCatalogId, modelCatalog.id),
          eq(externalModelBenchmarks.sourceName, filters.sourceName),
        ),
      );

    if (whereClause) {
      return baseQuery
        .where(whereClause)
        .orderBy(
          asc(modelCatalog.provider),
          asc(modelCatalog.label),
          asc(modelCatalog.modelId),
        );
    }

    return baseQuery.orderBy(
      asc(modelCatalog.provider),
      asc(modelCatalog.label),
      asc(modelCatalog.modelId),
    );
  });
}
