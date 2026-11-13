import { randomUUID } from "node:crypto";
import type {
  AuditEvent,
  JsonObject,
  NormalizedRequest,
  ProviderAttempt,
  ProviderExecutionResult,
  RequestStatus,
  ResolvedContext,
  RoutingDecision,
  SelectedRoutingDecision,
  UsageRecord,
} from "@neuralayer/core";
import {
  and,
  asc,
  auditEvents,
  createConfiguredDbConnection,
  type Database,
  desc,
  eq,
  modelCatalog,
  providerAccounts,
  requestAttempts,
  requests,
  resolveUsagePricingContext,
  usageRecords,
} from "@neuralayer/db";

export interface ChatPersistence {
  recordRequestStarted(input: {
    request: NormalizedRequest;
    context: ResolvedContext;
  }): Promise<void>;
  recordRoutingDecision(input: {
    request: NormalizedRequest;
    context: ResolvedContext;
    decision: RoutingDecision;
  }): Promise<void>;
  recordAttemptStarted(input: {
    request: NormalizedRequest;
    context: ResolvedContext;
    decision: SelectedRoutingDecision;
    attempt: ProviderAttempt;
  }): Promise<void>;
  recordAttemptCompleted(input: {
    request: NormalizedRequest;
    context: ResolvedContext;
    decision: SelectedRoutingDecision;
    attempt: ProviderAttempt;
    result: ProviderExecutionResult;
  }): Promise<void>;
  recordUsage(input: {
    request: NormalizedRequest;
    context: ResolvedContext;
    decision: SelectedRoutingDecision;
    usage: UsageRecord;
  }): Promise<PersistedUsageSummary | null>;
  recordAuditEvent(input: {
    request: NormalizedRequest;
    context: ResolvedContext;
    auditEvent: AuditEvent;
  }): Promise<void>;
  recordRequestCompleted(input: {
    request: NormalizedRequest;
    context: ResolvedContext;
    status: RequestStatus;
  }): Promise<void>;
}

export interface PersistedUsageSummary {
  usageSource: "provider_reported" | "estimated";
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  costInputUsd?: number;
  costOutputUsd?: number;
  costTotalUsd?: number;
  pricingVersion?: string;
  currency: "USD";
}

export function createNoopChatPersistence(): ChatPersistence {
  return {
    async recordRequestStarted() {},
    async recordRoutingDecision() {},
    async recordAttemptStarted() {},
    async recordAttemptCompleted() {},
    async recordUsage() {
      return null;
    },
    async recordAuditEvent() {},
    async recordRequestCompleted() {},
  };
}

interface ChatPersistenceDependencies {
  database?: Database;
}

interface PersistedAttemptRecord {
  id: string;
  attemptNumber: number;
}

interface NormalizedUsageMeasurements {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  costUsd?: number;
}

interface UsagePricingRates {
  inputPer1mTokensUsd?: number;
  outputPer1mTokensUsd?: number;
}

const COST_TIER_FALLBACK_RATES = {
  low: {
    inputPer1mTokensUsd: 1,
    outputPer1mTokensUsd: 5,
  },
  medium: {
    inputPer1mTokensUsd: 3,
    outputPer1mTokensUsd: 15,
  },
  high: {
    inputPer1mTokensUsd: 10,
    outputPer1mTokensUsd: 50,
  },
} as const;

function cloneJsonValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function toStoredJsonObject(value: JsonObject | Record<string, unknown>) {
  return cloneJsonValue(value);
}

function toStoredOptionalJsonObject(
  value: JsonObject | Record<string, unknown> | null | undefined,
) {
  if (!value) {
    return null;
  }

  return cloneJsonValue(value);
}

function toCostNumeric(value?: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }

  return value.toFixed(8);
}

function toUsageNumber(value?: number) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return undefined;
  }

  return value;
}

function roundUsd(value?: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }

  return Number(value.toFixed(8));
}

function normalizeUsageMeasurements(
  usage: UsageRecord,
): NormalizedUsageMeasurements {
  const inputTokens = toUsageNumber(usage.inputTokens);
  const outputTokens = toUsageNumber(usage.outputTokens);
  const totalTokens =
    toUsageNumber(usage.totalTokens) ??
    (typeof inputTokens === "number" && typeof outputTokens === "number"
      ? inputTokens + outputTokens
      : undefined);
  const costUsd = toUsageNumber(usage.costUsd);

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    costUsd,
  };
}

function hasUsageMeasurements(measurements: NormalizedUsageMeasurements) {
  return (
    typeof measurements.costUsd === "number" ||
    typeof measurements.inputTokens === "number" ||
    typeof measurements.outputTokens === "number" ||
    typeof measurements.totalTokens === "number"
  );
}

function buildStoredRequestEnvelope(request: NormalizedRequest) {
  return {
    stream: request.stream,
    message_count: request.messages.length,
    message_roles: request.messages.map((message) => message.role),
    metadata_keys: Object.keys(request.metadata ?? {}).sort(),
    prompt_redacted: true,
  };
}

function canEstimateUsageWithRates(
  measurements: NormalizedUsageMeasurements,
  rates: UsagePricingRates,
) {
  if (
    typeof measurements.inputTokens === "number" &&
    typeof rates.inputPer1mTokensUsd !== "number"
  ) {
    return false;
  }

  if (
    typeof measurements.outputTokens === "number" &&
    typeof rates.outputPer1mTokensUsd !== "number"
  ) {
    return false;
  }

  if (
    typeof measurements.totalTokens === "number" &&
    typeof measurements.inputTokens !== "number" &&
    typeof measurements.outputTokens !== "number" &&
    typeof rates.inputPer1mTokensUsd !== "number" &&
    typeof rates.outputPer1mTokensUsd !== "number"
  ) {
    return false;
  }

  return true;
}

function estimateUsageCosts(
  measurements: NormalizedUsageMeasurements,
  rates: UsagePricingRates,
) {
  const costInputUsd =
    typeof measurements.inputTokens === "number" &&
    typeof rates.inputPer1mTokensUsd === "number"
      ? roundUsd(
          (measurements.inputTokens * rates.inputPer1mTokensUsd) / 1_000_000,
        )
      : undefined;
  const costOutputUsd =
    typeof measurements.outputTokens === "number" &&
    typeof rates.outputPer1mTokensUsd === "number"
      ? roundUsd(
          (measurements.outputTokens * rates.outputPer1mTokensUsd) / 1_000_000,
        )
      : undefined;

  if (typeof costInputUsd === "number" || typeof costOutputUsd === "number") {
    return {
      costInputUsd,
      costOutputUsd,
      costTotalUsd: roundUsd((costInputUsd ?? 0) + (costOutputUsd ?? 0)),
    };
  }

  if (typeof measurements.totalTokens !== "number") {
    return null;
  }

  const totalTokenRate = Math.max(
    rates.inputPer1mTokensUsd ?? 0,
    rates.outputPer1mTokensUsd ?? 0,
  );

  if (totalTokenRate <= 0) {
    return null;
  }

  return {
    costInputUsd: undefined,
    costOutputUsd: undefined,
    costTotalUsd: roundUsd(
      (measurements.totalTokens * totalTokenRate) / 1_000_000,
    ),
  };
}

async function resolvePersistedUsageSummary(
  database: Database,
  input: {
    decision: SelectedRoutingDecision;
    usage: UsageRecord;
  },
): Promise<PersistedUsageSummary | null> {
  const measurements = normalizeUsageMeasurements(input.usage);

  if (!hasUsageMeasurements(measurements)) {
    return null;
  }

  if (typeof measurements.costUsd === "number") {
    return {
      usageSource: "provider_reported",
      inputTokens: measurements.inputTokens,
      outputTokens: measurements.outputTokens,
      totalTokens: measurements.totalTokens,
      costTotalUsd: roundUsd(measurements.costUsd),
      currency: "USD",
    };
  }

  const pricingContext = await resolveUsagePricingContext(
    {
      provider: input.usage.provider,
      modelId: input.usage.model,
      benchmarkSource: input.decision.benchmarkSource,
      benchmarkTimestamp: input.decision.benchmarkTimestamp,
    },
    database,
  );

  if (!pricingContext) {
    return null;
  }

  const benchmarkRates: UsagePricingRates = {
    inputPer1mTokensUsd: pricingContext.priceInputPer1mTokensUsd,
    outputPer1mTokensUsd: pricingContext.priceOutputPer1mTokensUsd,
  };
  const benchmarkEstimate = canEstimateUsageWithRates(
    measurements,
    benchmarkRates,
  )
    ? estimateUsageCosts(measurements, benchmarkRates)
    : null;

  if (benchmarkEstimate) {
    return {
      usageSource: "estimated",
      inputTokens: measurements.inputTokens,
      outputTokens: measurements.outputTokens,
      totalTokens: measurements.totalTokens,
      costInputUsd: benchmarkEstimate.costInputUsd,
      costOutputUsd: benchmarkEstimate.costOutputUsd,
      costTotalUsd: benchmarkEstimate.costTotalUsd,
      pricingVersion: `${pricingContext.benchmarkSource}:${pricingContext.benchmarkTimestamp}`,
      currency: "USD",
    };
  }

  const fallbackEstimate = estimateUsageCosts(
    measurements,
    COST_TIER_FALLBACK_RATES[pricingContext.costTier],
  );

  if (!fallbackEstimate) {
    return null;
  }

  return {
    usageSource: "estimated",
    inputTokens: measurements.inputTokens,
    outputTokens: measurements.outputTokens,
    totalTokens: measurements.totalTokens,
    costInputUsd: fallbackEstimate.costInputUsd,
    costOutputUsd: fallbackEstimate.costOutputUsd,
    costTotalUsd: fallbackEstimate.costTotalUsd,
    pricingVersion: "catalog_cost_tier_v1",
    currency: "USD",
  };
}

async function withPersistenceDatabase<T>(
  dependencies: ChatPersistenceDependencies,
  operation: (database: Database) => Promise<T>,
): Promise<T> {
  if (dependencies.database) {
    return operation(dependencies.database);
  }

  const { db, queryClient } = createConfiguredDbConnection();

  try {
    return await operation(db);
  } finally {
    await queryClient.end({ timeout: 5 }).catch(() => undefined);
  }
}

async function resolveProviderAccountId(
  database: Database,
  input: {
    workspaceId: string;
    provider: SelectedRoutingDecision["selected"]["provider"];
  },
) {
  const [providerAccount] = await database
    .select({
      id: providerAccounts.id,
    })
    .from(providerAccounts)
    .where(
      and(
        eq(providerAccounts.workspaceId, input.workspaceId),
        eq(providerAccounts.provider, input.provider),
        eq(providerAccounts.status, "active"),
      ),
    )
    .orderBy(asc(providerAccounts.displayName), asc(providerAccounts.id))
    .limit(1);

  if (!providerAccount) {
    throw new Error(
      `No active provider account found for ${input.workspaceId}/${input.provider}.`,
    );
  }

  return providerAccount.id;
}

async function resolveModelCatalogId(
  database: Database,
  input: {
    provider: SelectedRoutingDecision["selected"]["provider"];
    modelId: string;
  },
) {
  const [catalogEntry] = await database
    .select({
      id: modelCatalog.id,
    })
    .from(modelCatalog)
    .where(
      and(
        eq(modelCatalog.provider, input.provider),
        eq(modelCatalog.modelId, input.modelId),
      ),
    )
    .limit(1);

  return catalogEntry?.id ?? null;
}

async function loadNextAttemptNumber(database: Database, requestId: string) {
  const [latestAttempt] = await database
    .select({
      attemptNumber: requestAttempts.attemptNumber,
    })
    .from(requestAttempts)
    .where(eq(requestAttempts.requestId, requestId))
    .orderBy(desc(requestAttempts.attemptNumber))
    .limit(1);

  return (latestAttempt?.attemptNumber ?? 0) + 1;
}

async function resolvePersistedAttemptRecord(
  database: Database,
  attemptRecords: Map<string, PersistedAttemptRecord>,
  requestId: string,
) {
  const cachedRecord = attemptRecords.get(requestId);

  if (cachedRecord) {
    return cachedRecord;
  }

  const [persistedAttempt] = await database
    .select({
      id: requestAttempts.id,
      attemptNumber: requestAttempts.attemptNumber,
    })
    .from(requestAttempts)
    .where(eq(requestAttempts.requestId, requestId))
    .orderBy(desc(requestAttempts.attemptNumber))
    .limit(1);

  if (!persistedAttempt) {
    return null;
  }

  const record = {
    id: persistedAttempt.id,
    attemptNumber: persistedAttempt.attemptNumber,
  } satisfies PersistedAttemptRecord;

  attemptRecords.set(requestId, record);

  return record;
}

export function createDatabaseChatPersistence(
  dependencies: ChatPersistenceDependencies = {},
): ChatPersistence {
  const persistedAttempts = new Map<string, PersistedAttemptRecord>();

  return {
    async recordRequestStarted(input) {
      await withPersistenceDatabase(dependencies, async (database) => {
        await database.insert(requests).values({
          id: input.context.requestId,
          workspaceId: input.context.workspaceId,
          projectId: input.context.projectId,
          apiKeyId: input.context.apiKeyId,
          source: input.request.source,
          mode: input.context.mode,
          taskType: input.context.taskType ?? "general",
          status: "running",
          clientRequestId: input.request.requestId ?? input.context.requestId,
          normalizedRequestJson: toStoredJsonObject(
            buildStoredRequestEnvelope(input.request),
          ),
          requestMetadata: toStoredOptionalJsonObject(input.request.metadata),
          startedAt: new Date(),
        });
      });
    },
    async recordRoutingDecision(input) {
      await withPersistenceDatabase(dependencies, async (database) => {
        await database.insert(auditEvents).values({
          id: randomUUID(),
          workspaceId: input.context.workspaceId,
          projectId: input.context.projectId,
          actorType: "api_key",
          actorApiKeyId: input.context.apiKeyId,
          eventType: "chat.routing.decision",
          entityType: "request",
          entityId: input.context.requestId,
          eventPayload: toStoredJsonObject({
            message: input.decision.selectionReasonText,
            request_id: input.context.requestId,
            mode: input.context.mode,
            task_type: input.context.taskType ?? "general",
            outcome: input.decision.outcome,
            selection_reason_code: input.decision.selectionReasonCode,
            selection_reason_text: input.decision.selectionReasonText,
            selected:
              input.decision.outcome === "selected"
                ? input.decision.selected
                : null,
            alternatives:
              input.decision.outcome === "selected"
                ? (input.decision.alternatives ?? [])
                : [],
            excluded_candidates: input.decision.excludedCandidates ?? [],
            policy_decisions: input.decision.policyDecisions ?? [],
            warnings: input.decision.warnings ?? [],
            benchmark_source: input.decision.benchmarkSource ?? null,
            benchmark_timestamp: input.decision.benchmarkTimestamp ?? null,
            fallbacks_used: input.decision.fallbacksUsed ?? [],
            routing_profile_id: input.decision.routingProfileId ?? null,
            routing_decision: input.decision,
          }),
          createdAt: new Date(),
        });
      });
    },
    async recordAttemptStarted(input) {
      await withPersistenceDatabase(dependencies, async (database) => {
        const [providerAccountId, modelCatalogId, attemptNumber] =
          await Promise.all([
            resolveProviderAccountId(database, {
              workspaceId: input.context.workspaceId,
              provider: input.decision.selected.provider,
            }),
            resolveModelCatalogId(database, {
              provider: input.decision.selected.provider,
              modelId: input.decision.selected.model,
            }),
            loadNextAttemptNumber(database, input.context.requestId),
          ]);
        const attemptId = randomUUID();

        await database.insert(requestAttempts).values({
          id: attemptId,
          requestId: input.context.requestId,
          workspaceId: input.context.workspaceId,
          projectId: input.context.projectId,
          providerAccountId,
          provider: input.decision.selected.provider,
          modelCatalogId,
          modelId: input.decision.selected.model,
          attemptNumber,
          selectionReason: input.decision.selectionReasonText,
          status: input.attempt.status,
          startedAt: new Date(input.attempt.startedAt),
        });

        persistedAttempts.set(input.context.requestId, {
          id: attemptId,
          attemptNumber,
        });
      });
    },
    async recordAttemptCompleted(input) {
      await withPersistenceDatabase(dependencies, async (database) => {
        const persistedAttempt = await resolvePersistedAttemptRecord(
          database,
          persistedAttempts,
          input.context.requestId,
        );

        if (!persistedAttempt) {
          throw new Error(
            `No persisted attempt found for request ${input.context.requestId}.`,
          );
        }

        await database
          .update(requestAttempts)
          .set({
            status: input.attempt.status,
            completedAt: input.attempt.completedAt
              ? new Date(input.attempt.completedAt)
              : new Date(),
            latencyMs: input.attempt.latencyMs,
            errorType: input.attempt.errorType,
            errorCode: input.result.error?.code,
            errorMessage:
              input.attempt.errorMessage ?? input.result.error?.message ?? null,
            providerRequestId: input.result.responseId,
            providerResponseMetadata: toStoredJsonObject({
              finish_reason: input.result.finishReason ?? null,
              provider_request_status: input.result.requestStatus,
              provider_error_type: input.result.error?.type ?? null,
              provider_error_code: input.result.error?.code ?? null,
            }),
            updatedAt: new Date(),
          })
          .where(eq(requestAttempts.id, persistedAttempt.id));
      });
    },
    async recordUsage(input) {
      return withPersistenceDatabase(dependencies, async (database) => {
        const persistedAttempt = await resolvePersistedAttemptRecord(
          database,
          persistedAttempts,
          input.context.requestId,
        );

        if (!persistedAttempt) {
          throw new Error(
            `No persisted attempt found for usage on request ${input.context.requestId}.`,
          );
        }

        const persistedUsageSummary = await resolvePersistedUsageSummary(
          database,
          {
            decision: input.decision,
            usage: input.usage,
          },
        );

        if (!persistedUsageSummary) {
          return null;
        }

        await database.insert(usageRecords).values({
          id: randomUUID(),
          workspaceId: input.context.workspaceId,
          projectId: input.context.projectId,
          requestId: input.context.requestId,
          attemptId: persistedAttempt.id,
          provider: input.usage.provider,
          modelId: input.usage.model,
          usageSource: persistedUsageSummary.usageSource,
          inputTokens: persistedUsageSummary.inputTokens,
          outputTokens: persistedUsageSummary.outputTokens,
          totalTokens: persistedUsageSummary.totalTokens,
          costInput: toCostNumeric(persistedUsageSummary.costInputUsd),
          costOutput: toCostNumeric(persistedUsageSummary.costOutputUsd),
          costTotal: toCostNumeric(persistedUsageSummary.costTotalUsd),
          currency: persistedUsageSummary.currency,
          pricingVersion: persistedUsageSummary.pricingVersion,
          recordedAt: new Date(),
        });

        return persistedUsageSummary;
      });
    },
    async recordAuditEvent(input) {
      await withPersistenceDatabase(dependencies, async (database) => {
        const actorType = input.auditEvent.actorType ?? "system";

        await database.insert(auditEvents).values({
          id: randomUUID(),
          workspaceId: input.context.workspaceId,
          projectId: input.auditEvent.projectId ?? input.context.projectId,
          actorType,
          actorApiKeyId:
            actorType === "api_key" ? input.context.apiKeyId : undefined,
          eventType: input.auditEvent.eventType,
          entityType: "request",
          entityId: input.auditEvent.requestId ?? input.context.requestId,
          eventPayload: toStoredJsonObject({
            message: input.auditEvent.message,
            request_id: input.auditEvent.requestId ?? input.context.requestId,
            metadata: input.auditEvent.metadata ?? null,
          }),
          createdAt: new Date(input.auditEvent.createdAt),
        });
      });
    },
    async recordRequestCompleted(input) {
      await withPersistenceDatabase(dependencies, async (database) => {
        await database
          .update(requests)
          .set({
            status: input.status,
            completedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(requests.id, input.context.requestId));
      });

      persistedAttempts.delete(input.context.requestId);
    },
  };
}
