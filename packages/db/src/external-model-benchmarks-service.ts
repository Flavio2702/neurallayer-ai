import type {
  BenchmarkSourceName,
  JsonObject,
  NormalizedExternalModelBenchmark,
  ProviderName,
} from "@neuralayer/core";

import { and, asc, eq, inArray, or } from "drizzle-orm";
import { getModelCatalogMappingKey } from "./catalog";
import type { Database } from "./client";
import { withDatabase } from "./connection-helpers";
import { externalModelBenchmarks, modelCatalog } from "./schema";

export interface ExternalModelBenchmarkCatalogRow {
  id: string;
  provider: ProviderName;
  modelId: string;
  metadata: Record<string, unknown> | null;
}

export interface ExternalModelBenchmarkExistingMapping {
  externalStableModelId: string;
  modelMappingKey: string;
  modelCatalogId: string;
}

export interface ExternalModelBenchmarkUpsertRecord {
  id: string;
  sourceName: BenchmarkSourceName;
  externalStableModelId: string;
  modelMappingKey: string;
  modelCatalogId: string;
  provider: (typeof externalModelBenchmarks.$inferInsert)["provider"];
  modelId: string;
  qualityGeneralScore?: string | null;
  qualityCodingScore?: string | null;
  priceInputPer1mTokensUsd?: string | null;
  priceOutputPer1mTokensUsd?: string | null;
  outputTokensPerSecond?: string | null;
  timeToFirstTokenMs?: string | null;
  syncedAt: Date;
  rawPayload?: JsonObject | null;
}

export interface RunExternalBenchmarkSyncInput {
  sourceName: BenchmarkSourceName;
  records: NormalizedExternalModelBenchmark[];
  syncedAt?: string | Date;
}

export interface ExternalBenchmarkSyncSkippedRecord {
  externalStableModelId?: string;
  provider?: ProviderName;
  modelId?: string;
  mappingKey?: string;
  reason: string;
  rawPayload?: JsonObject | null;
}

export interface ExternalBenchmarkSyncResult {
  sourceName: BenchmarkSourceName;
  syncedAt: string;
  upserted: number;
  skipped: ExternalBenchmarkSyncSkippedRecord[];
}

export interface BuildExternalBenchmarkSyncPlanInput {
  sourceName: BenchmarkSourceName;
  records: NormalizedExternalModelBenchmark[];
  catalogRows: ExternalModelBenchmarkCatalogRow[];
  syncedAt?: string | Date;
}

export interface BuildExternalBenchmarkSyncPlanResult {
  sourceName: BenchmarkSourceName;
  syncedAt: string;
  recordsToUpsert: ExternalModelBenchmarkUpsertRecord[];
  skipped: ExternalBenchmarkSyncSkippedRecord[];
}

export interface FilterExternalBenchmarkSyncConflictsInput {
  recordsToUpsert: ExternalModelBenchmarkUpsertRecord[];
  existingMappings: ExternalModelBenchmarkExistingMapping[];
}

export interface FilterExternalBenchmarkSyncConflictsResult {
  recordsToUpsert: ExternalModelBenchmarkUpsertRecord[];
  skipped: ExternalBenchmarkSyncSkippedRecord[];
}

interface CatalogAliasLookup {
  ambiguousAliasKeys: Set<string>;
  rowsByAliasKey: Map<string, ExternalModelBenchmarkCatalogRow>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toStringArray(value: unknown) {
  if (typeof value === "string") {
    return [value];
  }

  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === "string");
}

function normalizeAliasValue(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function buildAliasLookupKey(
  provider: ProviderName,
  aliasKind: "name" | "slug",
  value: string,
) {
  return `${provider}:${aliasKind}:${normalizeAliasValue(value)}`;
}

function readArtificialAnalysisAliases(
  metadata: Record<string, unknown> | null,
) {
  const externalBenchmarks = isRecord(metadata?.externalBenchmarks)
    ? metadata.externalBenchmarks
    : undefined;
  const artificialAnalysis = isRecord(externalBenchmarks?.artificialAnalysis)
    ? externalBenchmarks.artificialAnalysis
    : undefined;

  return {
    names: [
      ...new Set(
        toStringArray(artificialAnalysis?.names)
          .map((value) => value.trim())
          .filter((value) => value.length > 0),
      ),
    ],
    slugs: [
      ...new Set(
        toStringArray(artificialAnalysis?.slugs)
          .map((value) => value.trim())
          .filter((value) => value.length > 0),
      ),
    ],
  };
}

function buildCatalogAliasLookup(
  sourceName: BenchmarkSourceName,
  catalogRows: ExternalModelBenchmarkCatalogRow[],
): CatalogAliasLookup {
  const rowsByAliasKey = new Map<string, ExternalModelBenchmarkCatalogRow>();
  const ambiguousAliasKeys = new Set<string>();

  if (sourceName !== "artificial_analysis") {
    return {
      ambiguousAliasKeys,
      rowsByAliasKey,
    };
  }

  for (const row of catalogRows) {
    const aliases = readArtificialAnalysisAliases(row.metadata);

    for (const slug of aliases.slugs) {
      const aliasKey = buildAliasLookupKey(row.provider, "slug", slug);
      const existingRow = rowsByAliasKey.get(aliasKey);

      if (existingRow && existingRow.id !== row.id) {
        rowsByAliasKey.delete(aliasKey);
        ambiguousAliasKeys.add(aliasKey);
        continue;
      }

      if (!ambiguousAliasKeys.has(aliasKey)) {
        rowsByAliasKey.set(aliasKey, row);
      }
    }

    for (const name of aliases.names) {
      const aliasKey = buildAliasLookupKey(row.provider, "name", name);
      const existingRow = rowsByAliasKey.get(aliasKey);

      if (existingRow && existingRow.id !== row.id) {
        rowsByAliasKey.delete(aliasKey);
        ambiguousAliasKeys.add(aliasKey);
        continue;
      }

      if (!ambiguousAliasKeys.has(aliasKey)) {
        rowsByAliasKey.set(aliasKey, row);
      }
    }
  }

  return {
    ambiguousAliasKeys,
    rowsByAliasKey,
  };
}

function toOptionalNumericString(value?: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return value.toString();
}

function parseSyncedAt(value?: string | Date) {
  if (!value) {
    return new Date();
  }

  const parsedValue = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(parsedValue.valueOf())) {
    throw new Error(`Invalid syncedAt value: ${String(value)}`);
  }

  return parsedValue;
}

function buildExternalModelBenchmarkId(
  sourceName: BenchmarkSourceName,
  modelCatalogId: string,
) {
  return `bench_${sourceName}_${modelCatalogId}`;
}

function getRecordMappingKey(record: NormalizedExternalModelBenchmark) {
  if (!record.mappingKey.trim()) {
    return undefined;
  }

  return record.mappingKey.trim();
}

function createSkippedRecord(
  record: Partial<NormalizedExternalModelBenchmark>,
  reason: string,
): ExternalBenchmarkSyncSkippedRecord {
  return {
    externalStableModelId: record.externalStableModelId,
    provider: record.provider,
    modelId:
      record.externalModelSlug ?? record.externalModelName ?? record.modelId,
    mappingKey:
      typeof record.mappingKey === "string" &&
      record.mappingKey.trim().length > 0
        ? record.mappingKey.trim()
        : undefined,
    reason,
    rawPayload: record.rawPayload ?? null,
  };
}

function resolveCatalogRowForRecord(
  record: NormalizedExternalModelBenchmark,
  input: {
    catalogByMappingKey: Map<string, ExternalModelBenchmarkCatalogRow>;
    aliasLookup: CatalogAliasLookup;
    sourceName: BenchmarkSourceName;
  },
): {
  catalogRow?: ExternalModelBenchmarkCatalogRow;
  skipped?: ExternalBenchmarkSyncSkippedRecord;
} {
  const directMappingKey = getRecordMappingKey(record);

  if (directMappingKey) {
    const mappedCatalogRow = input.catalogByMappingKey.get(directMappingKey);

    if (!mappedCatalogRow) {
      return {
        skipped: createSkippedRecord(
          record,
          "No matching model catalog entry found for the provided mapping key.",
        ),
      };
    }

    return {
      catalogRow: mappedCatalogRow,
    };
  }

  const resolvedAliasRows = new Map<string, ExternalModelBenchmarkCatalogRow>();
  const slugCandidates = [record.externalModelSlug, record.modelId].filter(
    (value): value is string => typeof value === "string",
  );
  const nameCandidates = [record.externalModelName].filter(
    (value): value is string => typeof value === "string",
  );

  for (const slug of new Set(slugCandidates)) {
    const aliasKey = buildAliasLookupKey(record.provider, "slug", slug);

    if (input.aliasLookup.ambiguousAliasKeys.has(aliasKey)) {
      return {
        skipped: createSkippedRecord(
          record,
          "Artificial Analysis slug alias is ambiguous across model catalog entries.",
        ),
      };
    }

    const aliasRow = input.aliasLookup.rowsByAliasKey.get(aliasKey);

    if (aliasRow) {
      resolvedAliasRows.set(aliasRow.id, aliasRow);
    }
  }

  for (const name of new Set(nameCandidates)) {
    const aliasKey = buildAliasLookupKey(record.provider, "name", name);

    if (input.aliasLookup.ambiguousAliasKeys.has(aliasKey)) {
      return {
        skipped: createSkippedRecord(
          record,
          "Artificial Analysis name alias is ambiguous across model catalog entries.",
        ),
      };
    }

    const aliasRow = input.aliasLookup.rowsByAliasKey.get(aliasKey);

    if (aliasRow) {
      resolvedAliasRows.set(aliasRow.id, aliasRow);
    }
  }

  if (resolvedAliasRows.size > 1) {
    return {
      skipped: createSkippedRecord(
        record,
        "Artificial Analysis aliases resolve to multiple model catalog entries.",
      ),
    };
  }

  const resolvedAliasRow = [...resolvedAliasRows.values()][0];

  if (resolvedAliasRow) {
    return {
      catalogRow: resolvedAliasRow,
    };
  }

  const fallbackMappingKey = getModelCatalogMappingKey(
    record.provider,
    record.modelId,
  );
  const fallbackCatalogRow = input.catalogByMappingKey.get(fallbackMappingKey);

  if (fallbackCatalogRow) {
    return {
      catalogRow: fallbackCatalogRow,
    };
  }

  return {
    skipped: createSkippedRecord(
      record,
      "No matching model catalog entry found for the external benchmark aliases.",
    ),
  };
}

export async function upsertExternalModelBenchmarks(
  records: ExternalModelBenchmarkUpsertRecord[],
  database?: Database,
) {
  return withDatabase(database, async (db) => {
    if (records.length === 0) {
      return [] as (typeof externalModelBenchmarks.$inferSelect)[];
    }

    return db.transaction(async (tx) => {
      const rows: (typeof externalModelBenchmarks.$inferSelect)[] = [];

      for (const record of records) {
        const [row] = await tx
          .insert(externalModelBenchmarks)
          .values({
            id: record.id,
            sourceName: record.sourceName,
            externalStableModelId: record.externalStableModelId,
            modelMappingKey: record.modelMappingKey,
            modelCatalogId: record.modelCatalogId,
            provider: record.provider,
            modelId: record.modelId,
            qualityGeneralScore: record.qualityGeneralScore ?? null,
            qualityCodingScore: record.qualityCodingScore ?? null,
            priceInputPer1mTokensUsd: record.priceInputPer1mTokensUsd ?? null,
            priceOutputPer1mTokensUsd: record.priceOutputPer1mTokensUsd ?? null,
            outputTokensPerSecond: record.outputTokensPerSecond ?? null,
            timeToFirstTokenMs: record.timeToFirstTokenMs ?? null,
            syncedAt: record.syncedAt,
            rawPayload: record.rawPayload ?? null,
          })
          .onConflictDoUpdate({
            target: [
              externalModelBenchmarks.sourceName,
              externalModelBenchmarks.modelMappingKey,
            ],
            set: {
              externalStableModelId: record.externalStableModelId,
              modelMappingKey: record.modelMappingKey,
              provider: record.provider,
              modelId: record.modelId,
              qualityGeneralScore: record.qualityGeneralScore ?? null,
              qualityCodingScore: record.qualityCodingScore ?? null,
              priceInputPer1mTokensUsd: record.priceInputPer1mTokensUsd ?? null,
              priceOutputPer1mTokensUsd:
                record.priceOutputPer1mTokensUsd ?? null,
              outputTokensPerSecond: record.outputTokensPerSecond ?? null,
              timeToFirstTokenMs: record.timeToFirstTokenMs ?? null,
              syncedAt: record.syncedAt,
              rawPayload: record.rawPayload ?? null,
              updatedAt: new Date(),
            },
          })
          .returning();

        if (row) {
          rows.push(row);
        }
      }

      return rows;
    });
  });
}

export function buildExternalBenchmarkSyncPlan(
  input: BuildExternalBenchmarkSyncPlanInput,
): BuildExternalBenchmarkSyncPlanResult {
  const syncedAt = parseSyncedAt(input.syncedAt);
  const catalogByMappingKey = new Map(
    input.catalogRows.map((row) => [
      getModelCatalogMappingKey(row.provider, row.modelId),
      row,
    ]),
  );
  const aliasLookup = buildCatalogAliasLookup(
    input.sourceName,
    input.catalogRows,
  );
  const skipped: ExternalBenchmarkSyncSkippedRecord[] = [];
  const recordsToUpsert: ExternalModelBenchmarkUpsertRecord[] = [];

  for (const record of input.records) {
    const resolution = resolveCatalogRowForRecord(record, {
      catalogByMappingKey,
      aliasLookup,
      sourceName: input.sourceName,
    });

    if (!resolution.catalogRow) {
      if (resolution.skipped) {
        skipped.push(resolution.skipped);
      }
      continue;
    }

    const mappingKey = getModelCatalogMappingKey(
      resolution.catalogRow.provider,
      resolution.catalogRow.modelId,
    );

    recordsToUpsert.push({
      id: buildExternalModelBenchmarkId(
        input.sourceName,
        resolution.catalogRow.id,
      ),
      sourceName: input.sourceName,
      externalStableModelId: record.externalStableModelId,
      modelMappingKey: mappingKey,
      modelCatalogId: resolution.catalogRow.id,
      provider: resolution.catalogRow.provider,
      modelId: resolution.catalogRow.modelId,
      qualityGeneralScore: toOptionalNumericString(record.qualityGeneralScore),
      qualityCodingScore: toOptionalNumericString(record.qualityCodingScore),
      priceInputPer1mTokensUsd: toOptionalNumericString(
        record.priceInputPer1mTokensUsd,
      ),
      priceOutputPer1mTokensUsd: toOptionalNumericString(
        record.priceOutputPer1mTokensUsd,
      ),
      outputTokensPerSecond: toOptionalNumericString(
        record.outputTokensPerSecond,
      ),
      timeToFirstTokenMs: toOptionalNumericString(record.timeToFirstTokenMs),
      syncedAt: record.syncedAt ? parseSyncedAt(record.syncedAt) : syncedAt,
      rawPayload: record.rawPayload ?? null,
    });
  }

  return {
    sourceName: input.sourceName,
    syncedAt: syncedAt.toISOString(),
    recordsToUpsert,
    skipped,
  };
}

export function filterExternalBenchmarkSyncConflicts(
  input: FilterExternalBenchmarkSyncConflictsInput,
): FilterExternalBenchmarkSyncConflictsResult {
  const skipped: ExternalBenchmarkSyncSkippedRecord[] = [];
  const existingMappingByExternalId = new Map(
    input.existingMappings.map((row) => [
      row.externalStableModelId,
      row.modelMappingKey,
    ]),
  );
  const existingMappingByModelMappingKey = new Map(
    input.existingMappings.map((row) => [
      row.modelMappingKey,
      row.externalStableModelId,
    ]),
  );
  const recordsToUpsert = input.recordsToUpsert.filter((record) => {
    const existingModelMappingKey = existingMappingByExternalId.get(
      record.externalStableModelId,
    );

    if (
      existingModelMappingKey &&
      existingModelMappingKey !== record.modelMappingKey
    ) {
      skipped.push({
        externalStableModelId: record.externalStableModelId,
        provider: record.provider,
        modelId: record.modelId,
        mappingKey: record.modelMappingKey,
        reason:
          "External stable model ID is already mapped to another model mapping key.",
        rawPayload: record.rawPayload ?? null,
      });

      return false;
    }

    const existingExternalStableModelId = existingMappingByModelMappingKey.get(
      record.modelMappingKey,
    );

    if (
      existingExternalStableModelId &&
      existingExternalStableModelId !== record.externalStableModelId
    ) {
      skipped.push({
        externalStableModelId: record.externalStableModelId,
        provider: record.provider,
        modelId: record.modelId,
        mappingKey: record.modelMappingKey,
        reason:
          "Model mapping key is already mapped to another external stable model ID.",
        rawPayload: record.rawPayload ?? null,
      });

      return false;
    }

    existingMappingByExternalId.set(
      record.externalStableModelId,
      record.modelMappingKey,
    );
    existingMappingByModelMappingKey.set(
      record.modelMappingKey,
      record.externalStableModelId,
    );

    return true;
  });

  return {
    recordsToUpsert,
    skipped,
  };
}

export async function runExternalBenchmarkSync(
  input: RunExternalBenchmarkSyncInput,
  database?: Database,
): Promise<ExternalBenchmarkSyncResult> {
  return withDatabase(database, async (db) => {
    const catalogRows = await db
      .select({
        id: modelCatalog.id,
        provider: modelCatalog.provider,
        modelId: modelCatalog.modelId,
        metadata: modelCatalog.metadata,
      })
      .from(modelCatalog)
      .orderBy(asc(modelCatalog.provider), asc(modelCatalog.modelId));

    const initialPlan = buildExternalBenchmarkSyncPlan({
      sourceName: input.sourceName,
      records: input.records,
      catalogRows,
      syncedAt: input.syncedAt,
    });

    if (initialPlan.recordsToUpsert.length === 0) {
      return {
        sourceName: input.sourceName,
        syncedAt: initialPlan.syncedAt,
        upserted: 0,
        skipped: initialPlan.skipped,
      };
    }

    const existingMappings = await db
      .select({
        externalStableModelId: externalModelBenchmarks.externalStableModelId,
        modelMappingKey: externalModelBenchmarks.modelMappingKey,
        modelCatalogId: externalModelBenchmarks.modelCatalogId,
      })
      .from(externalModelBenchmarks)
      .where(
        and(
          eq(externalModelBenchmarks.sourceName, input.sourceName),
          or(
            inArray(
              externalModelBenchmarks.externalStableModelId,
              initialPlan.recordsToUpsert.map(
                (record) => record.externalStableModelId,
              ),
            ),
            inArray(
              externalModelBenchmarks.modelMappingKey,
              initialPlan.recordsToUpsert.map(
                (record) => record.modelMappingKey,
              ),
            ),
          ),
        ),
      );

    const conflictFilter = filterExternalBenchmarkSyncConflicts({
      recordsToUpsert: initialPlan.recordsToUpsert,
      existingMappings,
    });
    const upsertedRows = await upsertExternalModelBenchmarks(
      conflictFilter.recordsToUpsert,
      db,
    );

    return {
      sourceName: input.sourceName,
      syncedAt: initialPlan.syncedAt,
      upserted: upsertedRows.length,
      skipped: [...initialPlan.skipped, ...conflictFilter.skipped],
    };
  });
}
