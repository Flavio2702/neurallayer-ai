import type { BenchmarkSourceName, ProviderName } from "@neuralayer/core";

import {
  and,
  asc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  max,
  or,
  sql,
} from "drizzle-orm";

import type { Database } from "./client";
import { withDatabase } from "./connection-helpers";
import { hasUsableStoredProviderCredentials } from "./provider-account-credentials";
import {
  externalModelBenchmarks,
  modelCatalog,
  policyRules,
  projects,
  providerAccounts,
  routingProfiles,
  usageRecords,
  workspaces,
} from "./schema";

function parseOptionalNumber(value?: string | null) {
  if (typeof value !== "string" || value.length === 0) {
    return undefined;
  }

  const parsedValue = Number(value);

  return Number.isFinite(parsedValue) ? parsedValue : undefined;
}

export async function listActiveWorkspaceProviderAccounts(
  workspaceId: string,
  database?: Database,
) {
  return withDatabase(database, async (db) => {
    const rows = await db
      .select({
        id: providerAccounts.id,
        workspaceId: providerAccounts.workspaceId,
        provider: providerAccounts.provider,
        displayName: providerAccounts.displayName,
        encryptedCredentials: providerAccounts.encryptedCredentials,
      })
      .from(providerAccounts)
      .where(
        and(
          eq(providerAccounts.workspaceId, workspaceId),
          eq(providerAccounts.status, "active"),
        ),
      )
      .orderBy(
        asc(providerAccounts.provider),
        asc(providerAccounts.displayName),
        asc(providerAccounts.id),
      );

    return rows
      .filter((row) =>
        hasUsableStoredProviderCredentials(row.encryptedCredentials),
      )
      .map(({ encryptedCredentials: _encryptedCredentials, ...row }) => row);
  });
}

export async function listActiveScopedPolicyRules(
  input: {
    workspaceId: string;
    projectId: string;
  },
  database?: Database,
) {
  return withDatabase(database, async (db) =>
    db
      .select({
        id: policyRules.id,
        workspaceId: policyRules.workspaceId,
        projectId: policyRules.projectId,
        name: policyRules.name,
        ruleType: policyRules.ruleType,
        enforcementMode: policyRules.enforcementMode,
        conditionsJson: policyRules.conditionsJson,
      })
      .from(policyRules)
      .where(
        and(
          eq(policyRules.workspaceId, input.workspaceId),
          eq(policyRules.status, "active"),
          or(
            isNull(policyRules.projectId),
            eq(policyRules.projectId, input.projectId),
          ),
        ),
      )
      .orderBy(
        asc(policyRules.projectId),
        asc(policyRules.ruleType),
        asc(policyRules.name),
        asc(policyRules.id),
      ),
  );
}

export interface ResolvedRoutingProfileRecord {
  id: string;
  rulesJson: Record<string, unknown>;
}

async function loadActiveRoutingProfileById(
  db: Database,
  input: {
    workspaceId: string;
    routingProfileId: string;
  },
) {
  return db
    .select({
      id: routingProfiles.id,
      rulesJson: routingProfiles.rulesJson,
    })
    .from(routingProfiles)
    .where(
      and(
        eq(routingProfiles.id, input.routingProfileId),
        eq(routingProfiles.workspaceId, input.workspaceId),
        eq(routingProfiles.status, "active"),
      ),
    )
    .limit(1);
}

export async function resolveRoutingProfileForProject(
  input: {
    workspaceId: string;
    projectId: string;
  },
  database?: Database,
): Promise<ResolvedRoutingProfileRecord | null> {
  return withDatabase(database, async (db) => {
    const [projectRow, workspaceRow] = await Promise.all([
      db
        .select({
          routingProfileId: projects.routingProfileId,
        })
        .from(projects)
        .where(
          and(
            eq(projects.id, input.projectId),
            eq(projects.workspaceId, input.workspaceId),
            eq(projects.status, "active"),
          ),
        )
        .limit(1),
      db
        .select({
          defaultRoutingProfileId: workspaces.defaultRoutingProfileId,
        })
        .from(workspaces)
        .where(
          and(
            eq(workspaces.id, input.workspaceId),
            eq(workspaces.status, "active"),
          ),
        )
        .limit(1),
    ]);

    const preferredRoutingProfileId =
      projectRow[0]?.routingProfileId ??
      workspaceRow[0]?.defaultRoutingProfileId;

    if (!preferredRoutingProfileId) {
      return null;
    }

    const [routingProfile] = await loadActiveRoutingProfileById(db, {
      workspaceId: input.workspaceId,
      routingProfileId: preferredRoutingProfileId,
    });

    return routingProfile ?? null;
  });
}

export interface LatestBenchmarkSnapshotRecord {
  sourceName: BenchmarkSourceName;
  syncedAt: string;
}

export interface RoutingCatalogBenchmarkRow {
  model: {
    id: string;
    provider: ProviderName;
    modelId: string;
    label: string;
    capabilityClasses: (typeof modelCatalog.$inferSelect)["capabilityClasses"];
    costTier: (typeof modelCatalog.$inferSelect)["costTier"];
    latencyTier: (typeof modelCatalog.$inferSelect)["latencyTier"];
    supportsChat: boolean;
    supportsStreaming: boolean;
    isActive: boolean;
    status: (typeof modelCatalog.$inferSelect)["status"];
  };
  benchmark: {
    sourceName: BenchmarkSourceName;
    syncedAt: string;
    qualityGeneralScore?: number;
    qualityCodingScore?: number;
    priceInputPer1mTokensUsd?: number;
    priceOutputPer1mTokensUsd?: number;
    outputTokensPerSecond?: number;
    timeToFirstTokenMs?: number;
  } | null;
}

export interface ListActiveChatModelCatalogWithLatestBenchmarksResult {
  snapshot: LatestBenchmarkSnapshotRecord | null;
  rows: RoutingCatalogBenchmarkRow[];
}

export interface ResolvedUsagePricingContext {
  provider: ProviderName;
  modelId: string;
  modelCatalogId: string;
  costTier: (typeof modelCatalog.$inferSelect)["costTier"];
  benchmarkSource?: BenchmarkSourceName;
  benchmarkTimestamp?: string;
  priceInputPer1mTokensUsd?: number;
  priceOutputPer1mTokensUsd?: number;
}

export async function listActiveChatModelCatalogWithLatestBenchmarks(
  input: {
    sourceName: BenchmarkSourceName;
    providers?: ProviderName[];
  },
  database?: Database,
): Promise<ListActiveChatModelCatalogWithLatestBenchmarksResult> {
  return withDatabase(database, async (db) => {
    const [snapshotRow] = await db
      .select({
        syncedAt: max(externalModelBenchmarks.syncedAt),
      })
      .from(externalModelBenchmarks)
      .where(eq(externalModelBenchmarks.sourceName, input.sourceName));

    const snapshot = snapshotRow?.syncedAt
      ? {
          sourceName: input.sourceName,
          syncedAt: snapshotRow.syncedAt.toISOString(),
        }
      : null;

    const baseConditions = [
      eq(modelCatalog.isActive, true),
      eq(modelCatalog.status, "active"),
      eq(modelCatalog.supportsChat, true),
    ];

    if (input.providers && input.providers.length > 0) {
      baseConditions.push(inArray(modelCatalog.provider, input.providers));
    }

    if (snapshot) {
      const rows = await db
        .select({
          model: modelCatalog,
          benchmark: externalModelBenchmarks,
        })
        .from(modelCatalog)
        .leftJoin(
          externalModelBenchmarks,
          and(
            eq(externalModelBenchmarks.modelCatalogId, modelCatalog.id),
            eq(externalModelBenchmarks.sourceName, input.sourceName),
            eq(externalModelBenchmarks.syncedAt, new Date(snapshot.syncedAt)),
          ),
        )
        .where(and(...baseConditions))
        .orderBy(
          asc(modelCatalog.provider),
          asc(modelCatalog.label),
          asc(modelCatalog.modelId),
        );

      return {
        snapshot,
        rows: rows.map((row) => ({
          model: {
            id: row.model.id,
            provider: row.model.provider,
            modelId: row.model.modelId,
            label: row.model.label,
            capabilityClasses: row.model.capabilityClasses,
            costTier: row.model.costTier,
            latencyTier: row.model.latencyTier,
            supportsChat: row.model.supportsChat,
            supportsStreaming: row.model.supportsStreaming,
            isActive: row.model.isActive,
            status: row.model.status,
          },
          benchmark: row.benchmark
            ? {
                sourceName: row.benchmark.sourceName,
                syncedAt: row.benchmark.syncedAt.toISOString(),
                qualityGeneralScore: parseOptionalNumber(
                  row.benchmark.qualityGeneralScore,
                ),
                qualityCodingScore: parseOptionalNumber(
                  row.benchmark.qualityCodingScore,
                ),
                priceInputPer1mTokensUsd: parseOptionalNumber(
                  row.benchmark.priceInputPer1mTokensUsd,
                ),
                priceOutputPer1mTokensUsd: parseOptionalNumber(
                  row.benchmark.priceOutputPer1mTokensUsd,
                ),
                outputTokensPerSecond: parseOptionalNumber(
                  row.benchmark.outputTokensPerSecond,
                ),
                timeToFirstTokenMs: parseOptionalNumber(
                  row.benchmark.timeToFirstTokenMs,
                ),
              }
            : null,
        })),
      };
    }

    const rows = await db
      .select({
        model: modelCatalog,
      })
      .from(modelCatalog)
      .where(and(...baseConditions))
      .orderBy(
        asc(modelCatalog.provider),
        asc(modelCatalog.label),
        asc(modelCatalog.modelId),
      );

    return {
      snapshot,
      rows: rows.map((row) => ({
        model: {
          id: row.model.id,
          provider: row.model.provider,
          modelId: row.model.modelId,
          label: row.model.label,
          capabilityClasses: row.model.capabilityClasses,
          costTier: row.model.costTier,
          latencyTier: row.model.latencyTier,
          supportsChat: row.model.supportsChat,
          supportsStreaming: row.model.supportsStreaming,
          isActive: row.model.isActive,
          status: row.model.status,
        },
        benchmark: null,
      })),
    };
  });
}

export async function resolveUsagePricingContext(
  input: {
    provider: ProviderName;
    modelId: string;
    benchmarkSource?: BenchmarkSourceName;
    benchmarkTimestamp?: string;
  },
  database?: Database,
): Promise<ResolvedUsagePricingContext | null> {
  return withDatabase(database, async (db) => {
    const [catalogEntry] = await db
      .select({
        id: modelCatalog.id,
        provider: modelCatalog.provider,
        modelId: modelCatalog.modelId,
        costTier: modelCatalog.costTier,
      })
      .from(modelCatalog)
      .where(
        and(
          eq(modelCatalog.provider, input.provider),
          eq(modelCatalog.modelId, input.modelId),
          eq(modelCatalog.isActive, true),
          eq(modelCatalog.status, "active"),
        ),
      )
      .limit(1);

    if (!catalogEntry) {
      return null;
    }

    const resolvedContext: ResolvedUsagePricingContext = {
      provider: catalogEntry.provider,
      modelId: catalogEntry.modelId,
      modelCatalogId: catalogEntry.id,
      costTier: catalogEntry.costTier,
    };

    if (!input.benchmarkSource || !input.benchmarkTimestamp) {
      return resolvedContext;
    }

    const benchmarkTimestamp = new Date(input.benchmarkTimestamp);

    if (Number.isNaN(benchmarkTimestamp.valueOf())) {
      return resolvedContext;
    }

    const [benchmarkRow] = await db
      .select({
        sourceName: externalModelBenchmarks.sourceName,
        syncedAt: externalModelBenchmarks.syncedAt,
        priceInputPer1mTokensUsd:
          externalModelBenchmarks.priceInputPer1mTokensUsd,
        priceOutputPer1mTokensUsd:
          externalModelBenchmarks.priceOutputPer1mTokensUsd,
      })
      .from(externalModelBenchmarks)
      .where(
        and(
          eq(externalModelBenchmarks.modelCatalogId, catalogEntry.id),
          eq(externalModelBenchmarks.sourceName, input.benchmarkSource),
          eq(externalModelBenchmarks.syncedAt, benchmarkTimestamp),
        ),
      )
      .limit(1);

    if (!benchmarkRow) {
      return resolvedContext;
    }

    return {
      ...resolvedContext,
      benchmarkSource: benchmarkRow.sourceName,
      benchmarkTimestamp: benchmarkRow.syncedAt.toISOString(),
      priceInputPer1mTokensUsd: parseOptionalNumber(
        benchmarkRow.priceInputPer1mTokensUsd,
      ),
      priceOutputPer1mTokensUsd: parseOptionalNumber(
        benchmarkRow.priceOutputPer1mTokensUsd,
      ),
    };
  });
}

export async function getWorkspaceRecordedCostForPeriod(
  input: {
    workspaceId: string;
    start: Date;
    end: Date;
  },
  database?: Database,
) {
  return withDatabase(database, async (db) => {
    const [row] = await db
      .select({
        totalCostUsd: sql<string>`coalesce(sum(${usageRecords.costTotal}), 0)::text`,
      })
      .from(usageRecords)
      .where(
        and(
          eq(usageRecords.workspaceId, input.workspaceId),
          eq(usageRecords.currency, "USD"),
          isNotNull(usageRecords.costTotal),
          gte(usageRecords.recordedAt, input.start),
          lt(usageRecords.recordedAt, input.end),
        ),
      );

    return {
      workspaceId: input.workspaceId,
      start: input.start.toISOString(),
      end: input.end.toISOString(),
      totalCostUsd: parseOptionalNumber(row?.totalCostUsd) ?? 0,
    };
  });
}
