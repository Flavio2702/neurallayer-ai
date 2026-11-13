import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { loadDatabaseConfig } from "@neuralayer/config";
import type {
  JsonObject,
  NormalizedExternalModelBenchmark,
  ProviderName,
} from "@neuralayer/core";

import type { Database } from "./client";
import {
  type ExternalBenchmarkSyncResult,
  type ExternalBenchmarkSyncSkippedRecord,
  runExternalBenchmarkSync,
} from "./external-model-benchmarks-service";

const ARTIFICIAL_ANALYSIS_LLM_MODELS_ENDPOINT =
  "https://artificialanalysis.ai/api/v2/data/llms/models";

export interface ArtificialAnalysisFetchResult {
  syncedAt: string;
  payload: unknown;
}

export interface ArtificialAnalysisFetchOptions {
  apiKey?: string;
  endpoint?: string;
  fetchImpl?: typeof fetch;
}

export interface ArtificialAnalysisSyncOptions {
  apiKey?: string;
  database?: Database;
  fetchImpl?: typeof fetch;
  inputPath?: string;
  syncedAt?: string | Date;
}

export interface ArtificialAnalysisNormalizationResult {
  records: NormalizedExternalModelBenchmark[];
  skipped: ExternalBenchmarkSyncSkippedRecord[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: Record<string, unknown> | undefined, key: string) {
  const candidate = value?.[key];

  return typeof candidate === "string" ? candidate : undefined;
}

function readNumber(value: Record<string, unknown> | undefined, key: string) {
  const candidate = value?.[key];

  if (typeof candidate === "number" && Number.isFinite(candidate)) {
    return candidate;
  }

  if (typeof candidate !== "string" || candidate.trim().length === 0) {
    return undefined;
  }

  const parsedValue = Number(candidate);

  return Number.isFinite(parsedValue) ? parsedValue : undefined;
}

function getConfiguredArtificialAnalysisApiKey() {
  const config = loadDatabaseConfig();

  return config.artificialAnalysis.apiKey;
}

function normalizeProviderName(value?: string): ProviderName | undefined {
  if (!value) {
    return undefined;
  }

  const normalizedValue = value.trim().toLowerCase();

  if (normalizedValue === "openai") {
    return "openai";
  }

  if (normalizedValue === "anthropic") {
    return "anthropic";
  }

  return undefined;
}

function getArtificialAnalysisModels(payload: unknown) {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (isRecord(payload) && Array.isArray(payload.data)) {
    return payload.data;
  }

  throw new Error(
    "Artificial Analysis payload must be an array of models or an object with a data array.",
  );
}

function buildNormalizationSkippedRecord(
  input: {
    externalStableModelId?: string;
    modelId?: string;
    provider?: ProviderName;
    rawPayload?: JsonObject | null;
  },
  reason: string,
): ExternalBenchmarkSyncSkippedRecord {
  return {
    externalStableModelId: input.externalStableModelId,
    modelId: input.modelId,
    provider: input.provider,
    reason,
    rawPayload: input.rawPayload ?? null,
  };
}

async function readArtificialAnalysisBenchmarkPayloadFromFile(
  inputPath: string,
  syncedAt?: string | Date,
): Promise<ArtificialAnalysisFetchResult> {
  const resolvedPath = resolve(process.cwd(), inputPath);
  const fileContents = await readFile(resolvedPath, "utf8");
  let payload: unknown;

  try {
    payload = JSON.parse(fileContents);
  } catch (error) {
    throw new Error(
      `Failed to parse Artificial Analysis payload from ${resolvedPath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  return {
    payload,
    syncedAt:
      syncedAt instanceof Date
        ? syncedAt.toISOString()
        : (syncedAt ?? new Date().toISOString()),
  };
}

export async function fetchArtificialAnalysisBenchmarkPayload(
  options: ArtificialAnalysisFetchOptions = {},
): Promise<ArtificialAnalysisFetchResult> {
  const apiKey = options.apiKey ?? getConfiguredArtificialAnalysisApiKey();

  if (!apiKey) {
    throw new Error(
      "Artificial Analysis API key is not configured. Set ARTIFICIAL_ANALYSIS_API_KEY or use --input for a manual import.",
    );
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(
    options.endpoint ?? ARTIFICIAL_ANALYSIS_LLM_MODELS_ENDPOINT,
    {
      headers: {
        "x-api-key": apiKey,
      },
      method: "GET",
    },
  );

  const rawBody = await response.text();

  if (!response.ok) {
    throw new Error(
      `Artificial Analysis fetch failed with HTTP ${response.status}: ${rawBody.slice(0, 500)}`,
    );
  }

  let payload: unknown;

  try {
    payload = rawBody.length > 0 ? JSON.parse(rawBody) : null;
  } catch (error) {
    throw new Error(
      `Artificial Analysis fetch returned invalid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  return {
    syncedAt: new Date().toISOString(),
    payload,
  };
}

export function normalizeArtificialAnalysisBenchmarkPayload(
  payload: unknown,
): ArtificialAnalysisNormalizationResult {
  const records: NormalizedExternalModelBenchmark[] = [];
  const skipped: ExternalBenchmarkSyncSkippedRecord[] = [];

  for (const model of getArtificialAnalysisModels(payload)) {
    if (!isRecord(model)) {
      skipped.push(
        buildNormalizationSkippedRecord(
          {},
          "Artificial Analysis model record must be a JSON object.",
        ),
      );
      continue;
    }

    const rawPayload = model as JsonObject;
    const externalStableModelId = readString(model, "id")?.trim();
    const externalModelSlug = readString(model, "slug")?.trim();
    const externalModelName = readString(model, "name")?.trim();
    const creator = isRecord(model.model_creator)
      ? model.model_creator
      : undefined;
    const externalProviderSlug = readString(creator, "slug")?.trim();
    const externalProviderName = readString(creator, "name")?.trim();
    const provider =
      normalizeProviderName(externalProviderSlug) ??
      normalizeProviderName(externalProviderName);

    if (!externalStableModelId) {
      skipped.push(
        buildNormalizationSkippedRecord(
          {
            modelId: externalModelSlug ?? externalModelName,
            rawPayload,
          },
          "Artificial Analysis model record is missing a stable model ID.",
        ),
      );
      continue;
    }

    if (!provider) {
      skipped.push(
        buildNormalizationSkippedRecord(
          {
            externalStableModelId,
            modelId: externalModelSlug ?? externalModelName,
            rawPayload,
          },
          "Artificial Analysis provider is unsupported or missing.",
        ),
      );
      continue;
    }

    if (!externalModelSlug && !externalModelName) {
      skipped.push(
        buildNormalizationSkippedRecord(
          {
            externalStableModelId,
            provider,
            rawPayload,
          },
          "Artificial Analysis model record is missing both slug and name aliases.",
        ),
      );
      continue;
    }

    const evaluations = isRecord(model.evaluations)
      ? model.evaluations
      : undefined;
    const pricing = isRecord(model.pricing) ? model.pricing : undefined;
    const timeToFirstTokenSeconds = readNumber(
      model,
      "median_time_to_first_token_seconds",
    );

    records.push({
      externalStableModelId,
      provider,
      modelId: externalModelSlug ?? externalModelName ?? externalStableModelId,
      mappingKey: "",
      externalModelSlug,
      externalModelName,
      externalProviderSlug,
      externalProviderName,
      qualityGeneralScore: readNumber(
        evaluations,
        "artificial_analysis_intelligence_index",
      ),
      qualityCodingScore: readNumber(
        evaluations,
        "artificial_analysis_coding_index",
      ),
      priceInputPer1mTokensUsd: readNumber(pricing, "price_1m_input_tokens"),
      priceOutputPer1mTokensUsd: readNumber(pricing, "price_1m_output_tokens"),
      outputTokensPerSecond: readNumber(
        model,
        "median_output_tokens_per_second",
      ),
      timeToFirstTokenMs:
        typeof timeToFirstTokenSeconds === "number"
          ? timeToFirstTokenSeconds * 1000
          : undefined,
      rawPayload,
    });
  }

  return {
    records,
    skipped,
  };
}

export async function syncArtificialAnalysis(
  options: ArtificialAnalysisSyncOptions = {},
): Promise<ExternalBenchmarkSyncResult> {
  const fetched = options.inputPath
    ? await readArtificialAnalysisBenchmarkPayloadFromFile(
        options.inputPath,
        options.syncedAt,
      )
    : await fetchArtificialAnalysisBenchmarkPayload({
        apiKey: options.apiKey,
        fetchImpl: options.fetchImpl,
      });
  const normalization = normalizeArtificialAnalysisBenchmarkPayload(
    fetched.payload,
  );
  const syncResult = await runExternalBenchmarkSync(
    {
      sourceName: "artificial_analysis",
      syncedAt:
        options.syncedAt instanceof Date
          ? options.syncedAt.toISOString()
          : (options.syncedAt ?? fetched.syncedAt),
      records: normalization.records,
    },
    options.database,
  );

  return {
    ...syncResult,
    skipped: [...normalization.skipped, ...syncResult.skipped],
  };
}

interface ArtificialAnalysisCliOptions {
  inputPath?: string;
  syncedAt?: string;
}

function parseArtificialAnalysisCliArgs(
  args: string[],
): ArtificialAnalysisCliOptions {
  const options: ArtificialAnalysisCliOptions = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--help") {
      return options;
    }

    if (arg === "--input") {
      const inputPath = args[index + 1];

      if (!inputPath) {
        throw new Error("Missing value for --input.");
      }

      options.inputPath = inputPath;
      index += 1;
      continue;
    }

    if (arg === "--synced-at") {
      const syncedAt = args[index + 1];

      if (!syncedAt) {
        throw new Error("Missing value for --synced-at.");
      }

      options.syncedAt = syncedAt;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function printArtificialAnalysisSyncUsage() {
  console.log(
    "Usage: tsx src/artificial-analysis-sync.ts [--input <path-to-json>] [--synced-at <iso-8601>]",
  );
}

if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.includes("--help")) {
    printArtificialAnalysisSyncUsage();
  } else {
    const options = parseArtificialAnalysisCliArgs(args);

    syncArtificialAnalysis(options)
      .then((result) => {
        console.log(JSON.stringify(result, null, 2));
      })
      .catch((error: unknown) => {
        console.error("Artificial Analysis sync failed.", error);
        process.exitCode = 1;
      });
  }
}
