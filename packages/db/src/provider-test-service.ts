import { randomUUID } from "node:crypto";

import type {
  NormalizedProviderError,
  ProviderExecutionResult,
  ProviderName,
  RequestStatus,
} from "@neuralayer/core";

import type { Database } from "./client";
import { withDatabase } from "./connection-helpers";
import {
  ProviderCredentialsResolutionError,
  resolveProviderAccountExecutionConfig,
  type StoredProviderCredentialConfig,
} from "./provider-account-credentials";
import { recordProviderAccountOperationalOutcome } from "./provider-account-posture-service";

const COST_TIER_RANK = {
  low: 0,
  medium: 1,
  high: 2,
} as const;

const LATENCY_TIER_RANK = {
  fast: 0,
  medium: 1,
  slow: 2,
} as const;

export interface ProviderConnectionTestExecutionInput {
  provider: ProviderName;
  model: string;
  requestId: string;
  config: StoredProviderCredentialConfig;
}

export type ProviderConnectionTestExecutor = (
  input: ProviderConnectionTestExecutionInput,
) => Promise<ProviderExecutionResult>;

export interface ProviderConnectionTestDependencies {
  runConnectionTest: ProviderConnectionTestExecutor;
  now?: Date | (() => Date);
}

export interface ProviderConnectionTestResult {
  providerAccountId: string | null;
  provider: ProviderName;
  modelId: string | null;
  requestStatus: RequestStatus;
  latencyMs: number | null;
  responseId: string | null;
  error: NormalizedProviderError | null;
  posture: Awaited<ReturnType<typeof recordProviderAccountOperationalOutcome>>;
}

function resolveNow(now: ProviderConnectionTestDependencies["now"]) {
  if (typeof now === "function") {
    return now();
  }

  return now instanceof Date ? now : new Date();
}

function createSafeFailureError(input: {
  type: NormalizedProviderError["type"];
  code: string;
  message: string;
  retryable?: boolean;
}): NormalizedProviderError {
  return {
    type: input.type,
    code: input.code,
    message: input.message,
    retryable: input.retryable ?? false,
  };
}

function createConnectionTestFailureResult(input: {
  provider: ProviderName;
  modelId: string | null;
  error: NormalizedProviderError;
  testedAt: Date;
  latencyMs?: number | null;
  responseId?: string | null;
  providerAccountId?: string | null;
  posture: Awaited<ReturnType<typeof recordProviderAccountOperationalOutcome>>;
}): ProviderConnectionTestResult {
  return {
    providerAccountId:
      input.providerAccountId ?? input.posture?.providerAccountId ?? null,
    provider: input.provider,
    modelId: input.modelId,
    requestStatus: "failed",
    latencyMs: input.latencyMs ?? null,
    responseId: input.responseId ?? null,
    error: input.error,
    posture: input.posture,
  };
}

function normalizeExecutionError(
  provider: ProviderName,
  error: unknown,
): NormalizedProviderError {
  void provider;

  return createSafeFailureError({
    type: "provider_unavailable",
    code: "provider_connection_test_failed",
    message: "Provider connection test failed unexpectedly.",
    retryable: false,
  });
}

async function selectProviderConnectionTestModel(
  workspaceId: string,
  provider: ProviderName,
  database?: Database,
) {
  return withDatabase(database, async (db) => {
    void workspaceId;

    const rows = await db.query.modelCatalog.findMany({
      where: (table, { and, eq }) =>
        and(
          eq(table.provider, provider),
          eq(table.status, "active"),
          eq(table.isActive, true),
          eq(table.supportsChat, true),
        ),
      orderBy: (table, { asc }) => [asc(table.modelId)],
    });

    const [selectedModel] = [...rows].sort((left, right) => {
      const costDifference =
        COST_TIER_RANK[left.costTier] - COST_TIER_RANK[right.costTier];

      if (costDifference !== 0) {
        return costDifference;
      }

      const latencyDifference =
        LATENCY_TIER_RANK[left.latencyTier] -
        LATENCY_TIER_RANK[right.latencyTier];

      if (latencyDifference !== 0) {
        return latencyDifference;
      }

      return left.modelId.localeCompare(right.modelId);
    });

    return selectedModel ?? null;
  });
}

export async function testWorkspaceProviderConnection(
  input: {
    workspaceId: string;
    provider: ProviderName;
  },
  dependencies: ProviderConnectionTestDependencies,
  database?: Database,
): Promise<ProviderConnectionTestResult> {
  const testedAt = resolveNow(dependencies.now);
  const selectedModel = await selectProviderConnectionTestModel(
    input.workspaceId,
    input.provider,
    database,
  );

  if (!selectedModel) {
    const error = createSafeFailureError({
      type: "provider_unavailable",
      code: "provider_test_model_unavailable",
      message:
        "No active chat-capable model is available for provider connection testing.",
    });
    const posture = await recordProviderAccountOperationalOutcome(
      {
        workspaceId: input.workspaceId,
        provider: input.provider,
        source: "provider_test",
        modelId: null,
        requestStatus: "failed",
        errorType: error.type,
        errorCode: error.code,
        errorMessage: error.message,
        testedAt,
      },
      database,
    );

    return createConnectionTestFailureResult({
      provider: input.provider,
      modelId: null,
      error,
      testedAt,
      posture,
    });
  }

  let resolvedConfig: Awaited<
    ReturnType<typeof resolveProviderAccountExecutionConfig>
  > | null = null;

  try {
    resolvedConfig = await resolveProviderAccountExecutionConfig(
      {
        workspaceId: input.workspaceId,
        provider: input.provider,
      },
      database,
    );
  } catch (error) {
    if (!(error instanceof ProviderCredentialsResolutionError)) {
      throw error;
    }

    const safeError = createSafeFailureError({
      type: "auth_error",
      code: error.code,
      message: error.message,
    });
    const posture = await recordProviderAccountOperationalOutcome(
      {
        providerAccountId: error.providerAccountId,
        workspaceId: input.workspaceId,
        provider: input.provider,
        source: "provider_test",
        modelId: selectedModel.modelId,
        requestStatus: "failed",
        errorType: safeError.type,
        errorCode: safeError.code,
        errorMessage: safeError.message,
        testedAt,
      },
      database,
    );

    return createConnectionTestFailureResult({
      provider: input.provider,
      providerAccountId: error.providerAccountId,
      modelId: selectedModel.modelId,
      error: safeError,
      testedAt,
      posture,
    });
  }

  if (!resolvedConfig) {
    const error = createSafeFailureError({
      type: "auth_error",
      code: "provider_configuration_missing",
      message:
        "No usable provider credentials are configured for this workspace.",
    });
    const posture = await recordProviderAccountOperationalOutcome(
      {
        workspaceId: input.workspaceId,
        provider: input.provider,
        source: "provider_test",
        modelId: selectedModel.modelId,
        requestStatus: "failed",
        errorType: error.type,
        errorCode: error.code,
        errorMessage: error.message,
        testedAt,
      },
      database,
    );

    return createConnectionTestFailureResult({
      provider: input.provider,
      modelId: selectedModel.modelId,
      error,
      testedAt,
      posture,
    });
  }

  let executionResult: ProviderExecutionResult;

  try {
    executionResult = await dependencies.runConnectionTest({
      provider: input.provider,
      model: selectedModel.modelId,
      requestId: `provtest_${randomUUID()}`,
      config: resolvedConfig.config,
    });
  } catch (error) {
    const safeError = normalizeExecutionError(input.provider, error);
    const posture = await recordProviderAccountOperationalOutcome(
      {
        providerAccountId: resolvedConfig.providerAccountId,
        source: "provider_test",
        modelId: selectedModel.modelId,
        requestStatus: "failed",
        errorType: safeError.type,
        errorCode: safeError.code,
        errorMessage: safeError.message,
        testedAt,
      },
      database,
    );

    return createConnectionTestFailureResult({
      provider: input.provider,
      providerAccountId: resolvedConfig.providerAccountId,
      modelId: selectedModel.modelId,
      error: safeError,
      testedAt,
      posture,
    });
  }

  const posture = await recordProviderAccountOperationalOutcome(
    {
      providerAccountId: resolvedConfig.providerAccountId,
      source: "provider_test",
      modelId: selectedModel.modelId,
      requestStatus: executionResult.requestStatus,
      errorType: executionResult.error?.type,
      errorCode: executionResult.error?.code,
      errorMessage: executionResult.error?.message,
      latencyMs: executionResult.latencyMs ?? null,
      responseId: executionResult.responseId,
      testedAt,
    },
    database,
  );

  return {
    providerAccountId: resolvedConfig.providerAccountId,
    provider: input.provider,
    modelId: selectedModel.modelId,
    requestStatus: executionResult.requestStatus,
    latencyMs: executionResult.latencyMs ?? null,
    responseId: executionResult.responseId ?? null,
    error: executionResult.error ?? null,
    posture,
  };
}
