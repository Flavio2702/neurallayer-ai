import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { type TestContext, test } from "node:test";

import { loadDatabaseConfig } from "@neuralayer/config";
import { and, eq, inArray } from "drizzle-orm";

import { createDbConnection } from "./client";
import { runExternalBenchmarkSync } from "./external-model-benchmarks-service";
import {
  listActiveChatModelCatalogWithLatestBenchmarks,
  resolveUsagePricingContext,
} from "./runtime-routing-service";
import { externalModelBenchmarks, modelCatalog } from "./schema";

async function openIntegrationDatabase(t: TestContext) {
  const {
    database: { url },
  } = loadDatabaseConfig();
  const { db, queryClient } = createDbConnection(url);

  try {
    await db.select({ id: modelCatalog.id }).from(modelCatalog).limit(1);
  } catch (error) {
    await queryClient.end({ timeout: 5 });
    t.skip(
      `Configured database is unavailable for integration tests: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return null;
  }

  t.after(async () => {
    await queryClient.end({ timeout: 5 });
  });

  return { db };
}

test("listActiveChatModelCatalogWithLatestBenchmarks serves latest local benchmark rows and leaves gaps as null", async (t) => {
  const connection = await openIntegrationDatabase(t);

  if (!connection) {
    return;
  }

  const suffix = randomUUID().slice(0, 8);
  const firstModelCatalogId = `mdl_test_lookup_${suffix}_a`;
  const secondModelCatalogId = `mdl_test_lookup_${suffix}_b`;
  const firstModelId = `test-openai-local-lookup-${suffix}-a`;
  const secondModelId = `test-openai-local-lookup-${suffix}-b`;
  const firstAlias = `test-openai-local-alias-${suffix}-a`;
  const secondAlias = `test-openai-local-alias-${suffix}-b`;

  try {
    await connection.db.insert(modelCatalog).values([
      {
        id: firstModelCatalogId,
        provider: "openai",
        modelId: firstModelId,
        label: `OpenAI Local Lookup ${suffix} A`,
        status: "active",
        isActive: true,
        supportsChat: true,
        supportsStreaming: true,
        capabilityClasses: ["general"],
        costTier: "medium",
        latencyTier: "medium",
        metadata: {
          externalBenchmarks: {
            artificialAnalysis: {
              slugs: [firstAlias],
              names: [`OpenAI Local Lookup ${suffix} A`],
            },
          },
        },
      },
      {
        id: secondModelCatalogId,
        provider: "openai",
        modelId: secondModelId,
        label: `OpenAI Local Lookup ${suffix} B`,
        status: "active",
        isActive: true,
        supportsChat: true,
        supportsStreaming: true,
        capabilityClasses: ["general"],
        costTier: "medium",
        latencyTier: "medium",
        metadata: {
          externalBenchmarks: {
            artificialAnalysis: {
              slugs: [secondAlias],
              names: [`OpenAI Local Lookup ${suffix} B`],
            },
          },
        },
      },
    ]);

    const firstSync = await runExternalBenchmarkSync(
      {
        sourceName: "artificial_analysis",
        syncedAt: "2099-01-01T00:00:00.000Z",
        records: [
          {
            externalStableModelId: `aa_lookup_${suffix}_a`,
            provider: "openai",
            modelId: firstAlias,
            mappingKey: "",
            externalModelSlug: firstAlias,
            externalModelName: `OpenAI Local Lookup ${suffix} A`,
            qualityGeneralScore: 78,
            outputTokensPerSecond: 50,
          },
          {
            externalStableModelId: `aa_lookup_${suffix}_b`,
            provider: "openai",
            modelId: secondAlias,
            mappingKey: "",
            externalModelSlug: secondAlias,
            externalModelName: `OpenAI Local Lookup ${suffix} B`,
            qualityGeneralScore: 61,
            outputTokensPerSecond: 40,
          },
        ],
      },
      connection.db,
    );

    assert.equal(firstSync.upserted, 2);
    assert.equal(firstSync.skipped.length, 0);

    const secondSync = await runExternalBenchmarkSync(
      {
        sourceName: "artificial_analysis",
        syncedAt: "2099-01-02T00:00:00.000Z",
        records: [
          {
            externalStableModelId: `aa_lookup_${suffix}_a`,
            provider: "openai",
            modelId: firstAlias,
            mappingKey: "",
            externalModelSlug: firstAlias,
            externalModelName: `OpenAI Local Lookup ${suffix} A`,
            qualityGeneralScore: 91,
            outputTokensPerSecond: 72,
          },
        ],
      },
      connection.db,
    );

    assert.equal(secondSync.upserted, 1);
    assert.equal(secondSync.skipped.length, 0);

    const lookup = await listActiveChatModelCatalogWithLatestBenchmarks(
      {
        sourceName: "artificial_analysis",
        providers: ["openai"],
      },
      connection.db,
    );

    assert.equal(lookup.snapshot?.sourceName, "artificial_analysis");
    assert.equal(lookup.snapshot?.syncedAt, "2099-01-02T00:00:00.000Z");

    const firstRow = lookup.rows.find(
      (row) => row.model.id === firstModelCatalogId,
    );
    const secondRow = lookup.rows.find(
      (row) => row.model.id === secondModelCatalogId,
    );

    assert.ok(firstRow);
    assert.ok(secondRow);
    assert.equal(firstRow?.benchmark?.qualityGeneralScore, 91);
    assert.equal(firstRow?.benchmark?.outputTokensPerSecond, 72);
    assert.equal(firstRow?.benchmark?.syncedAt, "2099-01-02T00:00:00.000Z");
    assert.equal(secondRow?.benchmark, null);
  } finally {
    await connection.db
      .delete(externalModelBenchmarks)
      .where(
        inArray(externalModelBenchmarks.modelCatalogId, [
          firstModelCatalogId,
          secondModelCatalogId,
        ]),
      );
    await connection.db
      .delete(modelCatalog)
      .where(
        and(
          eq(modelCatalog.provider, "openai"),
          inArray(modelCatalog.id, [firstModelCatalogId, secondModelCatalogId]),
        ),
      );
  }
});

test("resolveUsagePricingContext returns exact benchmark snapshot pricing when it matches the selected model", async (t) => {
  const connection = await openIntegrationDatabase(t);

  if (!connection) {
    return;
  }

  const suffix = randomUUID().slice(0, 8);
  const modelCatalogId = `mdl_usage_pricing_${suffix}`;
  const modelId = `test-openai-pricing-${suffix}`;
  const modelAlias = `test-openai-pricing-alias-${suffix}`;
  const syncedAt = "2099-02-01T00:00:00.000Z";

  try {
    await connection.db.insert(modelCatalog).values({
      id: modelCatalogId,
      provider: "openai",
      modelId,
      label: `OpenAI Usage Pricing ${suffix}`,
      status: "active",
      isActive: true,
      supportsChat: true,
      supportsStreaming: true,
      capabilityClasses: ["general"],
      costTier: "medium",
      latencyTier: "medium",
      metadata: {
        externalBenchmarks: {
          artificialAnalysis: {
            slugs: [modelAlias],
            names: [`OpenAI Usage Pricing ${suffix}`],
          },
        },
      },
    });

    const sync = await runExternalBenchmarkSync(
      {
        sourceName: "artificial_analysis",
        syncedAt,
        records: [
          {
            externalStableModelId: `aa_usage_pricing_${suffix}`,
            provider: "openai",
            modelId: modelAlias,
            mappingKey: "",
            externalModelSlug: modelAlias,
            externalModelName: `OpenAI Usage Pricing ${suffix}`,
            priceInputPer1mTokensUsd: 1.5,
            priceOutputPer1mTokensUsd: 6,
          },
        ],
      },
      connection.db,
    );

    assert.equal(sync.upserted, 1);

    const pricing = await resolveUsagePricingContext(
      {
        provider: "openai",
        modelId,
        benchmarkSource: "artificial_analysis",
        benchmarkTimestamp: syncedAt,
      },
      connection.db,
    );

    assert.ok(pricing);
    assert.equal(pricing?.modelCatalogId, modelCatalogId);
    assert.equal(pricing?.costTier, "medium");
    assert.equal(pricing?.benchmarkSource, "artificial_analysis");
    assert.equal(pricing?.benchmarkTimestamp, syncedAt);
    assert.equal(pricing?.priceInputPer1mTokensUsd, 1.5);
    assert.equal(pricing?.priceOutputPer1mTokensUsd, 6);
  } finally {
    await connection.db
      .delete(externalModelBenchmarks)
      .where(eq(externalModelBenchmarks.modelCatalogId, modelCatalogId));
    await connection.db
      .delete(modelCatalog)
      .where(eq(modelCatalog.id, modelCatalogId));
  }
});

test("resolveUsagePricingContext falls back to active model cost tier when benchmark pricing is unavailable", async (t) => {
  const connection = await openIntegrationDatabase(t);

  if (!connection) {
    return;
  }

  const suffix = randomUUID().slice(0, 8);
  const modelCatalogId = `mdl_usage_fallback_${suffix}`;
  const modelId = `test-openai-fallback-${suffix}`;

  try {
    await connection.db.insert(modelCatalog).values({
      id: modelCatalogId,
      provider: "openai",
      modelId,
      label: `OpenAI Usage Fallback ${suffix}`,
      status: "active",
      isActive: true,
      supportsChat: true,
      supportsStreaming: true,
      capabilityClasses: ["general"],
      costTier: "high",
      latencyTier: "medium",
    });

    const pricing = await resolveUsagePricingContext(
      {
        provider: "openai",
        modelId,
        benchmarkSource: "artificial_analysis",
        benchmarkTimestamp: "2099-03-01T00:00:00.000Z",
      },
      connection.db,
    );

    assert.ok(pricing);
    assert.equal(pricing?.modelCatalogId, modelCatalogId);
    assert.equal(pricing?.costTier, "high");
    assert.equal(pricing?.benchmarkSource, undefined);
    assert.equal(pricing?.benchmarkTimestamp, undefined);
    assert.equal(pricing?.priceInputPer1mTokensUsd, undefined);
    assert.equal(pricing?.priceOutputPer1mTokensUsd, undefined);
  } finally {
    await connection.db
      .delete(modelCatalog)
      .where(eq(modelCatalog.id, modelCatalogId));
  }
});
