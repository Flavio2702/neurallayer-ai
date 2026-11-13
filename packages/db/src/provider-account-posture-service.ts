import { randomUUID } from "node:crypto";

import type { ProviderName, RequestStatus } from "@neuralayer/core";

import { REQUEST_STATUS_VALUES } from "@neuralayer/core";
import { asc, eq } from "drizzle-orm";

import type { Database } from "./client";
import { withDatabase } from "./connection-helpers";
import { auditEvents, providerAccounts } from "./schema";

export type ProviderAccountOutcomeSource = "runtime" | "provider_test";

export interface ProviderAccountOperationalOutcome {
  source: ProviderAccountOutcomeSource;
  provider: ProviderName;
  modelId: string | null;
  requestStatus: RequestStatus;
  errorType: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  latencyMs: number | null;
  responseId: string | null;
  testedAt: string;
}

export interface RecordProviderAccountOperationalOutcomeInput {
  providerAccountId?: string;
  workspaceId?: string;
  provider?: ProviderName;
  source: ProviderAccountOutcomeSource;
  modelId?: string | null;
  requestStatus: RequestStatus;
  errorType?: string;
  errorCode?: string;
  errorMessage?: string;
  latencyMs?: number | null;
  responseId?: string;
  testedAt?: Date | string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toOptionalString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function toOptionalNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : null;
}

function toDateISOString(value: Date | string | null | undefined) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  const parsed = new Date(value);

  return Number.isNaN(parsed.valueOf()) ? null : parsed.toISOString();
}

function isRequestStatus(value: unknown): value is RequestStatus {
  return REQUEST_STATUS_VALUES.includes(value as RequestStatus);
}

function deriveProviderTestStatus(input: {
  requestStatus: RequestStatus;
  errorType?: string | null;
  errorCode?: string | null;
}) {
  if (input.requestStatus === "succeeded") {
    return "ready";
  }

  if (
    input.errorCode === "provider_configuration_missing" ||
    input.errorCode === "invalid_provider_configuration"
  ) {
    return "configuration_error";
  }

  switch (input.errorType) {
    case "auth_error":
      return "auth_error";
    case "rate_limit":
      return "rate_limit";
    case "quota_exceeded":
      return "quota_exceeded";
    case "timeout":
      return "timeout";
    case "provider_unavailable":
      return "provider_unavailable";
    case "invalid_request":
      return "invalid_request";
    default:
      return "attention";
  }
}

function deriveProviderAccountStatus(input: {
  requestStatus: RequestStatus;
  errorType?: string | null;
  errorCode?: string | null;
}): "active" | "inactive" | "error" {
  if (input.requestStatus === "succeeded") {
    return "active";
  }

  if (
    input.errorType === "auth_error" ||
    input.errorCode === "provider_configuration_missing" ||
    input.errorCode === "invalid_provider_configuration"
  ) {
    return "error";
  }

  return "active";
}

function buildProviderConnectionTestAuditMessage(
  outcome: ProviderAccountOperationalOutcome,
) {
  if (outcome.requestStatus === "succeeded") {
    return `Provider connection test succeeded for ${outcome.provider}.`;
  }

  return `Provider connection test failed for ${outcome.provider}.`;
}

export function clearProviderAccountOperationalOutcomeMetadata(
  metadata: unknown,
) {
  if (!isRecord(metadata)) {
    return {};
  }

  const nextMetadata = { ...metadata };

  delete nextMetadata.lastProviderOutcome;
  delete nextMetadata.lastRuntimeOutcome;

  return nextMetadata;
}

function buildProviderAccountOperationalOutcome(
  input: RecordProviderAccountOperationalOutcomeInput,
  provider: ProviderName,
  testedAt: Date,
): ProviderAccountOperationalOutcome {
  const isSuccess = input.requestStatus === "succeeded";

  return {
    source: input.source,
    provider,
    modelId: toOptionalString(input.modelId) ?? null,
    requestStatus: input.requestStatus,
    errorType: isSuccess ? null : toOptionalString(input.errorType),
    errorCode: isSuccess ? null : toOptionalString(input.errorCode),
    errorMessage: isSuccess ? null : toOptionalString(input.errorMessage),
    latencyMs: toOptionalNumber(input.latencyMs),
    responseId: toOptionalString(input.responseId),
    testedAt: testedAt.toISOString(),
  };
}

function withProviderAccountOperationalOutcomeMetadata(
  metadata: unknown,
  outcome: ProviderAccountOperationalOutcome,
) {
  const nextMetadata = clearProviderAccountOperationalOutcomeMetadata(metadata);

  return {
    ...nextMetadata,
    lastProviderOutcome: outcome,
  };
}

export function readProviderAccountOperationalOutcome(
  metadata: unknown,
  provider?: ProviderName,
): ProviderAccountOperationalOutcome | null {
  if (!isRecord(metadata)) {
    return null;
  }

  const storedOutcome = isRecord(metadata.lastProviderOutcome)
    ? metadata.lastProviderOutcome
    : isRecord(metadata.lastRuntimeOutcome)
      ? metadata.lastRuntimeOutcome
      : null;

  if (!storedOutcome) {
    return null;
  }

  const testedAt = toDateISOString(
    storedOutcome.testedAt instanceof Date
      ? storedOutcome.testedAt
      : toOptionalString(storedOutcome.testedAt),
  );
  const requestStatus = isRequestStatus(storedOutcome.requestStatus)
    ? storedOutcome.requestStatus
    : null;
  const resolvedProvider =
    toOptionalString(storedOutcome.provider) ?? provider ?? null;
  const source =
    storedOutcome === metadata.lastRuntimeOutcome
      ? "runtime"
      : storedOutcome.source === "provider_test"
        ? "provider_test"
        : storedOutcome.source === "runtime"
          ? "runtime"
          : null;

  if (
    !testedAt ||
    !requestStatus ||
    !resolvedProvider ||
    (source !== "runtime" && source !== "provider_test")
  ) {
    return null;
  }

  return {
    source,
    provider: resolvedProvider as ProviderName,
    modelId: toOptionalString(storedOutcome.modelId),
    requestStatus,
    errorType: toOptionalString(storedOutcome.errorType),
    errorCode: toOptionalString(storedOutcome.errorCode),
    errorMessage: toOptionalString(storedOutcome.errorMessage),
    latencyMs: toOptionalNumber(storedOutcome.latencyMs),
    responseId: toOptionalString(storedOutcome.responseId),
    testedAt,
  };
}

export async function recordProviderAccountOperationalOutcome(
  input: RecordProviderAccountOperationalOutcomeInput,
  database?: Database,
) {
  return withDatabase(database, async (db) => {
    const account = input.providerAccountId
      ? await db.query.providerAccounts.findFirst({
          where: (table, { eq: equals }) =>
            equals(table.id, input.providerAccountId!),
        })
      : input.workspaceId && input.provider
        ? await db.query.providerAccounts.findFirst({
            where: (table, { and: andWhere, eq: equals }) =>
              andWhere(
                equals(table.workspaceId, input.workspaceId!),
                equals(table.provider, input.provider!),
              ),
            orderBy: (table) => [asc(table.displayName), asc(table.id)],
          })
        : null;

    if (!account) {
      return null;
    }

    const testedAt =
      input.testedAt instanceof Date
        ? input.testedAt
        : input.testedAt
          ? new Date(input.testedAt)
          : new Date();
    const outcome = buildProviderAccountOperationalOutcome(
      input,
      account.provider,
      testedAt,
    );
    const testStatus = deriveProviderTestStatus(outcome);
    const status = deriveProviderAccountStatus(outcome);

    await db
      .update(providerAccounts)
      .set({
        status,
        testStatus,
        lastTestedAt: testedAt,
        metadata: withProviderAccountOperationalOutcomeMetadata(
          account.metadata,
          outcome,
        ),
        updatedAt: new Date(),
      })
      .where(eq(providerAccounts.id, account.id));

    if (outcome.source === "provider_test") {
      await db.insert(auditEvents).values({
        id: randomUUID(),
        workspaceId: account.workspaceId,
        actorType: "system",
        eventType: "provider_account.connection_tested",
        entityType: "provider_account",
        entityId: account.id,
        eventPayload: {
          message: buildProviderConnectionTestAuditMessage(outcome),
          provider: outcome.provider,
          model: outcome.modelId,
          metadata: {
            source: outcome.source,
            request_status: outcome.requestStatus,
            error_type: outcome.errorType,
            error_code: outcome.errorCode,
            error_message: outcome.errorMessage,
            latency_ms: outcome.latencyMs,
            response_id: outcome.responseId,
          },
        },
        createdAt: testedAt,
      });
    }

    return {
      providerAccountId: account.id,
      status,
      testStatus,
      lastTestedAt: outcome.testedAt,
      lastProviderOutcome: outcome,
    };
  });
}
