import assert from "node:assert/strict";
import { test } from "node:test";

import { normalizeArtificialAnalysisBenchmarkPayload } from "./artificial-analysis-sync";

test("normalizeArtificialAnalysisBenchmarkPayload extracts metrics, TTFT, and raw payload", () => {
  const payload = {
    status: 200,
    data: [
      {
        id: "aa_gpt52",
        name: "GPT-5.2 (Non-reasoning)",
        slug: "gpt-5-2-non-reasoning",
        model_creator: {
          id: "creator_openai",
          name: "OpenAI",
          slug: "openai",
        },
        evaluations: {
          artificial_analysis_intelligence_index: 34,
          artificial_analysis_coding_index: 28.4,
        },
        pricing: {
          price_1m_input_tokens: 1.75,
          price_1m_output_tokens: 14,
        },
        median_output_tokens_per_second: 64.7,
        median_time_to_first_token_seconds: 12.345,
      },
    ],
  };

  const result = normalizeArtificialAnalysisBenchmarkPayload(payload);

  assert.equal(result.skipped.length, 0);
  assert.equal(result.records.length, 1);
  assert.deepEqual(result.records[0], {
    externalStableModelId: "aa_gpt52",
    provider: "openai",
    modelId: "gpt-5-2-non-reasoning",
    mappingKey: "",
    externalModelSlug: "gpt-5-2-non-reasoning",
    externalModelName: "GPT-5.2 (Non-reasoning)",
    externalProviderSlug: "openai",
    externalProviderName: "OpenAI",
    qualityGeneralScore: 34,
    qualityCodingScore: 28.4,
    priceInputPer1mTokensUsd: 1.75,
    priceOutputPer1mTokensUsd: 14,
    outputTokensPerSecond: 64.7,
    timeToFirstTokenMs: 12345,
    rawPayload: payload.data[0],
  });
});

test("normalizeArtificialAnalysisBenchmarkPayload reports skipped raw models for malformed or unsupported records", () => {
  const payload = {
    data: [
      "not-a-record",
      {
        id: "aa_unknown_provider",
        name: "Unknown Provider Model",
        slug: "unknown-provider-model",
        model_creator: {
          name: "Acme AI",
          slug: "acme-ai",
        },
      },
      {
        name: "Missing Stable ID",
        slug: "missing-stable-id",
        model_creator: {
          name: "OpenAI",
          slug: "openai",
        },
      },
    ],
  };

  const result = normalizeArtificialAnalysisBenchmarkPayload(payload);

  assert.equal(result.records.length, 0);
  assert.equal(result.skipped.length, 3);
  assert.equal(
    result.skipped[0]?.reason,
    "Artificial Analysis model record must be a JSON object.",
  );
  assert.equal(
    result.skipped[1]?.reason,
    "Artificial Analysis provider is unsupported or missing.",
  );
  assert.equal(
    result.skipped[2]?.reason,
    "Artificial Analysis model record is missing a stable model ID.",
  );
  assert.deepEqual(result.skipped[1]?.rawPayload, payload.data[1]);
});
