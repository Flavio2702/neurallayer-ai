import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildExternalBenchmarkSyncPlan,
  filterExternalBenchmarkSyncConflicts,
} from "./external-model-benchmarks-service";

test("buildExternalBenchmarkSyncPlan resolves Artificial Analysis records through model catalog metadata aliases", () => {
  const result = buildExternalBenchmarkSyncPlan({
    sourceName: "artificial_analysis",
    syncedAt: "2026-03-23T00:00:00.000Z",
    catalogRows: [
      {
        id: "mdl_openai_gpt_5_2",
        provider: "openai",
        modelId: "gpt-5.2",
        metadata: {
          externalBenchmarks: {
            artificialAnalysis: {
              slugs: ["gpt-5-2-non-reasoning"],
              names: ["GPT-5.2 (Non-reasoning)"],
            },
          },
        },
      },
    ],
    records: [
      {
        externalStableModelId: "aa_gpt52",
        provider: "openai",
        modelId: "gpt-5-2-non-reasoning",
        mappingKey: "",
        externalModelSlug: "gpt-5-2-non-reasoning",
        externalModelName: "GPT-5.2 (Non-reasoning)",
        qualityGeneralScore: 34,
        rawPayload: {
          id: "aa_gpt52",
          slug: "gpt-5-2-non-reasoning",
        },
      },
    ],
  });

  assert.equal(result.skipped.length, 0);
  assert.equal(result.recordsToUpsert.length, 1);
  assert.deepEqual(result.recordsToUpsert[0], {
    id: "bench_artificial_analysis_mdl_openai_gpt_5_2",
    sourceName: "artificial_analysis",
    externalStableModelId: "aa_gpt52",
    modelMappingKey: "openai:gpt-5.2",
    modelCatalogId: "mdl_openai_gpt_5_2",
    provider: "openai",
    modelId: "gpt-5.2",
    qualityGeneralScore: "34",
    qualityCodingScore: null,
    priceInputPer1mTokensUsd: null,
    priceOutputPer1mTokensUsd: null,
    outputTokensPerSecond: null,
    timeToFirstTokenMs: null,
    syncedAt: new Date("2026-03-23T00:00:00.000Z"),
    rawPayload: {
      id: "aa_gpt52",
      slug: "gpt-5-2-non-reasoning",
    },
  });
});

test("buildExternalBenchmarkSyncPlan skips unmapped or ambiguous Artificial Analysis aliases", () => {
  const unmappedResult = buildExternalBenchmarkSyncPlan({
    sourceName: "artificial_analysis",
    catalogRows: [
      {
        id: "mdl_openai_gpt_5_mini",
        provider: "openai",
        modelId: "gpt-5-mini",
        metadata: {
          externalBenchmarks: {
            artificialAnalysis: {
              slugs: ["gpt-5-mini"],
            },
          },
        },
      },
    ],
    records: [
      {
        externalStableModelId: "aa_gpt5mini_high",
        provider: "openai",
        modelId: "gpt-5-mini-high",
        mappingKey: "",
        externalModelSlug: "gpt-5-mini-high",
      },
    ],
  });

  assert.equal(unmappedResult.recordsToUpsert.length, 0);
  assert.equal(unmappedResult.skipped.length, 1);
  assert.equal(
    unmappedResult.skipped[0]?.reason,
    "No matching model catalog entry found for the external benchmark aliases.",
  );

  const ambiguousResult = buildExternalBenchmarkSyncPlan({
    sourceName: "artificial_analysis",
    catalogRows: [
      {
        id: "mdl_openai_a",
        provider: "openai",
        modelId: "model-a",
        metadata: {
          externalBenchmarks: {
            artificialAnalysis: {
              slugs: ["shared-alias"],
            },
          },
        },
      },
      {
        id: "mdl_openai_b",
        provider: "openai",
        modelId: "model-b",
        metadata: {
          externalBenchmarks: {
            artificialAnalysis: {
              slugs: ["shared-alias"],
            },
          },
        },
      },
    ],
    records: [
      {
        externalStableModelId: "aa_shared_alias",
        provider: "openai",
        modelId: "shared-alias",
        mappingKey: "",
        externalModelSlug: "shared-alias",
      },
    ],
  });

  assert.equal(ambiguousResult.recordsToUpsert.length, 0);
  assert.equal(ambiguousResult.skipped.length, 1);
  assert.equal(
    ambiguousResult.skipped[0]?.reason,
    "Artificial Analysis slug alias is ambiguous across model catalog entries.",
  );
});

test("filterExternalBenchmarkSyncConflicts skips stable ID and mapping collisions deterministically", () => {
  const result = filterExternalBenchmarkSyncConflicts({
    existingMappings: [
      {
        externalStableModelId: "aa_existing_external",
        modelMappingKey: "openai:gpt-5.2",
        modelCatalogId: "mdl_openai_gpt_5_2",
      },
      {
        externalStableModelId: "aa_existing_other",
        modelMappingKey: "anthropic:claude-sonnet-4-20250514",
        modelCatalogId: "mdl_anthropic_claude_sonnet_4_20250514",
      },
    ],
    recordsToUpsert: [
      {
        id: "bench_one",
        sourceName: "artificial_analysis",
        externalStableModelId: "aa_existing_external",
        modelMappingKey: "openai:gpt-5-mini",
        modelCatalogId: "mdl_openai_gpt_5_mini",
        provider: "openai",
        modelId: "gpt-5-mini",
        syncedAt: new Date("2026-03-23T00:00:00.000Z"),
      },
      {
        id: "bench_two",
        sourceName: "artificial_analysis",
        externalStableModelId: "aa_new_external",
        modelMappingKey: "anthropic:claude-sonnet-4-20250514",
        modelCatalogId: "mdl_anthropic_claude_sonnet_4_20250514",
        provider: "anthropic",
        modelId: "claude-sonnet-4-20250514",
        syncedAt: new Date("2026-03-23T00:00:00.000Z"),
      },
    ],
  });

  assert.equal(result.recordsToUpsert.length, 0);
  assert.equal(result.skipped.length, 2);
  assert.equal(
    result.skipped[0]?.reason,
    "External stable model ID is already mapped to another model mapping key.",
  );
  assert.equal(
    result.skipped[1]?.reason,
    "Model mapping key is already mapped to another external stable model ID.",
  );
});
