import type { RequestStatus } from "@neuralayer/core";

export const REQUEST_RUNTIME_AUDIT_EVENT_TYPES = [
  "chat.completions.completed",
  "chat.completions.blocked",
  "chat.completions.failed",
] as const;

export type RuntimeAuditEventType =
  (typeof REQUEST_RUNTIME_AUDIT_EVENT_TYPES)[number];

export interface RequestRuntimeProjectSummary {
  id: string;
  name: string;
  slug: string | null;
}

export interface RequestRuntimeRequestRecord {
  id: string;
  projectId: string;
  mode: string;
  status: RequestStatus;
  startedAt: Date;
  completedAt: Date | null;
  project: RequestRuntimeProjectSummary | null;
}

export interface RequestRuntimeAttemptRecord {
  requestId: string;
  provider: string;
  modelId: string;
  selectionReason: string | null;
  status:
    | "pending"
    | "running"
    | "succeeded"
    | "failed"
    | "timeout"
    | "blocked";
  latencyMs: number | null;
  errorType: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  startedAt: Date;
  completedAt: Date | null;
  attemptNumber: number;
}

export interface RequestRuntimeUsageRecord {
  id: string;
  requestId: string;
  usageSource: string;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  costTotal: string | null;
  currency: string;
  recordedAt: Date;
}

export interface RequestRuntimeAuditEventRecord {
  id: string;
  projectId: string | null;
  entityId: string;
  eventType: string;
  eventPayload: Record<string, unknown>;
  createdAt: Date;
  project: RequestRuntimeProjectSummary | null;
}

export interface RequestRuntimeUsageSummary {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  source: string;
}

export interface RequestRuntimeCostSummary {
  totalUsd: number | null;
  currency: string | null;
  source: string;
}

export interface RequestRuntimeSelectionReason {
  code: string | null;
  text: string | null;
}

export interface RequestRuntimeIssueSummary {
  kind: "blocked" | "error";
  code: string | null;
  type: string | null;
  text: string | null;
}

export interface RequestRuntimeOutcomeSummary {
  eventType: RuntimeAuditEventType;
  timestamp: string;
  message: string | null;
  requestStatus: RequestStatus | null;
  provider: string | null;
  model: string | null;
  errorType: string | null;
  errorCode: string | null;
  latencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  costTotalUsd: number | null;
  currency: string | null;
  usageSource: string | null;
  selectionReasonCode: string | null;
  selectionReasonText: string | null;
}

export interface RequestRuntimeSummary {
  requestId: string;
  timestamp: string;
  completedAt: string | null;
  project: {
    id: string;
    name: string;
    slug: string | null;
  };
  mode: string;
  provider: string | null;
  model: string | null;
  status: RequestStatus;
  latencyMs: number | null;
  usage: RequestRuntimeUsageSummary | null;
  cost: RequestRuntimeCostSummary | null;
  selectionReason: RequestRuntimeSelectionReason;
  issue: RequestRuntimeIssueSummary | null;
  primaryOutcome: RequestRuntimeOutcomeSummary | null;
}

interface ParsedRoutingDecisionSummary {
  outcome: string | null;
  selectionReasonCode: string | null;
  selectionReasonText: string | null;
  provider: string | null;
  model: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function toOptionalString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

export function toOptionalNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : null;
}

function toRequestStatus(value: unknown): RequestStatus | null {
  switch (value) {
    case "pending":
    case "running":
    case "succeeded":
    case "failed":
    case "blocked":
      return value;
    default:
      return null;
  }
}

function toISOString(value: Date | string | null | undefined) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  const parsed = new Date(value);

  return Number.isNaN(parsed.valueOf()) ? null : parsed.toISOString();
}

export function resolveProjectSummary(
  project: RequestRuntimeProjectSummary | null,
  fallback: {
    id: string | null;
    name: string;
    slug: string | null;
  },
) {
  return project
    ? {
        id: project.id,
        name: project.name,
        slug: project.slug,
      }
    : fallback;
}

function getAuditMetadata(payload: Record<string, unknown> | null | undefined) {
  return isRecord(payload?.metadata) ? payload.metadata : null;
}

function extractRoutingDecisionSummary(
  events: RequestRuntimeAuditEventRecord[],
): ParsedRoutingDecisionSummary {
  const routingEvent = events.find(
    (event) => event.eventType === "chat.routing.decision",
  );

  if (!routingEvent || !isRecord(routingEvent.eventPayload)) {
    return {
      outcome: null,
      selectionReasonCode: null,
      selectionReasonText: null,
      provider: null,
      model: null,
    };
  }

  const payload = routingEvent.eventPayload;
  const routingDecision = isRecord(payload.routing_decision)
    ? payload.routing_decision
    : null;
  const selected = isRecord(routingDecision?.selected)
    ? routingDecision.selected
    : isRecord(payload.selected)
      ? payload.selected
      : null;

  return {
    outcome:
      toOptionalString(routingDecision?.outcome) ??
      toOptionalString(payload.outcome),
    selectionReasonCode:
      toOptionalString(routingDecision?.selectionReasonCode) ??
      toOptionalString(payload.selection_reason_code),
    selectionReasonText:
      toOptionalString(routingDecision?.selectionReasonText) ??
      toOptionalString(payload.selection_reason_text) ??
      toOptionalString(payload.message),
    provider:
      toOptionalString(selected?.provider) ??
      toOptionalString(payload.provider),
    model: toOptionalString(selected?.model) ?? toOptionalString(payload.model),
  };
}

export function extractRuntimeOutcomeSummary(
  event: RequestRuntimeAuditEventRecord | undefined,
): RequestRuntimeOutcomeSummary | null {
  if (
    !event ||
    !REQUEST_RUNTIME_AUDIT_EVENT_TYPES.includes(
      event.eventType as RuntimeAuditEventType,
    ) ||
    !isRecord(event.eventPayload)
  ) {
    return null;
  }

  const payload = event.eventPayload;
  const metadata = getAuditMetadata(payload);

  return {
    eventType: event.eventType as RuntimeAuditEventType,
    timestamp: event.createdAt.toISOString(),
    message: toOptionalString(payload.message),
    requestStatus: toRequestStatus(metadata?.request_status),
    provider:
      toOptionalString(metadata?.provider) ??
      toOptionalString(payload.provider),
    model: toOptionalString(metadata?.model) ?? toOptionalString(payload.model),
    errorType: toOptionalString(metadata?.error_type),
    errorCode: toOptionalString(metadata?.error_code),
    latencyMs: toOptionalNumber(metadata?.latency_ms),
    inputTokens: toOptionalNumber(metadata?.input_tokens),
    outputTokens: toOptionalNumber(metadata?.output_tokens),
    totalTokens: toOptionalNumber(metadata?.total_tokens),
    costTotalUsd: toOptionalNumber(metadata?.cost_total_usd),
    currency: toOptionalString(metadata?.currency),
    usageSource: toOptionalString(metadata?.usage_source),
    selectionReasonCode: toOptionalString(metadata?.selection_reason_code),
    selectionReasonText: toOptionalString(metadata?.selection_reason_text),
  };
}

function deriveResolvedStatus(input: {
  requestStatus: RequestStatus;
  routingDecision: ParsedRoutingDecisionSummary;
  latestAttempt: RequestRuntimeAttemptRecord | null;
  blockedOutcome: RequestRuntimeOutcomeSummary | null;
  completedOutcome: RequestRuntimeOutcomeSummary | null;
  failedOutcome: RequestRuntimeOutcomeSummary | null;
}): RequestStatus {
  if (input.blockedOutcome && !input.latestAttempt) {
    return "blocked";
  }

  if (input.completedOutcome) {
    return "succeeded";
  }

  if (input.failedOutcome) {
    return "failed";
  }

  if (input.latestAttempt) {
    switch (input.latestAttempt.status) {
      case "succeeded":
        return "succeeded";
      case "blocked":
        return "blocked";
      case "failed":
      case "timeout":
        return "failed";
      case "pending":
      case "running":
        return "running";
    }
  }

  if (input.routingDecision.outcome === "blocked") {
    return "blocked";
  }

  return input.requestStatus;
}

function derivePrimaryOutcome(input: {
  resolvedStatus: RequestStatus;
  blockedOutcome: RequestRuntimeOutcomeSummary | null;
  completedOutcome: RequestRuntimeOutcomeSummary | null;
  failedOutcome: RequestRuntimeOutcomeSummary | null;
}) {
  if (input.resolvedStatus === "blocked") {
    return input.blockedOutcome;
  }

  if (input.resolvedStatus === "succeeded") {
    return input.completedOutcome;
  }

  if (input.resolvedStatus === "failed") {
    return input.failedOutcome;
  }

  return input.completedOutcome ?? input.blockedOutcome ?? input.failedOutcome;
}

function deriveSelectionReason(input: {
  routingDecision: ParsedRoutingDecisionSummary;
  primaryOutcome: RequestRuntimeOutcomeSummary | null;
  latestAttempt: RequestRuntimeAttemptRecord | null;
}): RequestRuntimeSelectionReason {
  return {
    code:
      input.routingDecision.selectionReasonCode ??
      input.primaryOutcome?.selectionReasonCode ??
      null,
    text:
      input.routingDecision.selectionReasonText ??
      input.latestAttempt?.selectionReason ??
      input.primaryOutcome?.selectionReasonText ??
      null,
  };
}

function deriveUsageSummary(
  usageRecord: RequestRuntimeUsageRecord | null,
  primaryOutcome: RequestRuntimeOutcomeSummary | null,
): RequestRuntimeUsageSummary | null {
  if (usageRecord) {
    return {
      inputTokens: usageRecord.inputTokens,
      outputTokens: usageRecord.outputTokens,
      totalTokens: usageRecord.totalTokens,
      source: usageRecord.usageSource,
    };
  }

  if (
    primaryOutcome &&
    (primaryOutcome.inputTokens !== null ||
      primaryOutcome.outputTokens !== null ||
      primaryOutcome.totalTokens !== null)
  ) {
    return {
      inputTokens: primaryOutcome.inputTokens,
      outputTokens: primaryOutcome.outputTokens,
      totalTokens: primaryOutcome.totalTokens,
      source: primaryOutcome.usageSource ?? "audit_fallback",
    };
  }

  return null;
}

function deriveCostSummary(
  usageRecord: RequestRuntimeUsageRecord | null,
  primaryOutcome: RequestRuntimeOutcomeSummary | null,
): RequestRuntimeCostSummary | null {
  if (usageRecord) {
    return {
      totalUsd: toOptionalNumber(usageRecord.costTotal),
      currency: usageRecord.currency,
      source: usageRecord.usageSource,
    };
  }

  if (
    primaryOutcome?.costTotalUsd !== null &&
    primaryOutcome?.costTotalUsd !== undefined
  ) {
    return {
      totalUsd: primaryOutcome.costTotalUsd,
      currency: primaryOutcome.currency ?? "USD",
      source: primaryOutcome.usageSource ?? "audit_fallback",
    };
  }

  return null;
}

function deriveIssueSummary(input: {
  resolvedStatus: RequestStatus;
  routingDecision: ParsedRoutingDecisionSummary;
  blockedOutcome: RequestRuntimeOutcomeSummary | null;
  failedOutcome: RequestRuntimeOutcomeSummary | null;
  latestAttempt: RequestRuntimeAttemptRecord | null;
}): RequestRuntimeIssueSummary | null {
  if (input.resolvedStatus === "blocked") {
    return {
      kind: "blocked",
      code:
        input.blockedOutcome?.errorCode ??
        input.blockedOutcome?.selectionReasonCode ??
        input.routingDecision.selectionReasonCode,
      type: input.blockedOutcome?.errorType ?? "policy_blocked",
      text:
        input.blockedOutcome?.message ??
        input.blockedOutcome?.selectionReasonText ??
        input.routingDecision.selectionReasonText,
    };
  }

  if (input.resolvedStatus === "failed") {
    return {
      kind: "error",
      code:
        input.failedOutcome?.errorCode ??
        input.latestAttempt?.errorCode ??
        null,
      type:
        input.failedOutcome?.errorType ??
        input.latestAttempt?.errorType ??
        null,
      text:
        input.failedOutcome?.message ??
        input.latestAttempt?.errorMessage ??
        "Request failed during provider execution.",
    };
  }

  return null;
}

export function resolveRequestRuntimeSummary(input: {
  requestRow: RequestRuntimeRequestRecord;
  latestAttempt: RequestRuntimeAttemptRecord | null;
  usageRecord: RequestRuntimeUsageRecord | null;
  requestEvents: RequestRuntimeAuditEventRecord[];
}): RequestRuntimeSummary {
  const routingDecision = extractRoutingDecisionSummary(input.requestEvents);
  const blockedOutcome = extractRuntimeOutcomeSummary(
    input.requestEvents.find(
      (event) => event.eventType === "chat.completions.blocked",
    ),
  );
  const completedOutcome = extractRuntimeOutcomeSummary(
    input.requestEvents.find(
      (event) => event.eventType === "chat.completions.completed",
    ),
  );
  const failedOutcome = extractRuntimeOutcomeSummary(
    input.requestEvents.find(
      (event) => event.eventType === "chat.completions.failed",
    ),
  );
  const resolvedStatus = deriveResolvedStatus({
    requestStatus: input.requestRow.status,
    routingDecision,
    latestAttempt: input.latestAttempt,
    blockedOutcome,
    completedOutcome,
    failedOutcome,
  });
  const primaryOutcome = derivePrimaryOutcome({
    resolvedStatus,
    blockedOutcome,
    completedOutcome,
    failedOutcome,
  });

  return {
    requestId: input.requestRow.id,
    timestamp: input.requestRow.startedAt.toISOString(),
    completedAt: toISOString(input.requestRow.completedAt),
    project: input.requestRow.project
      ? {
          id: input.requestRow.project.id,
          name: input.requestRow.project.name,
          slug: input.requestRow.project.slug,
        }
      : {
          id: input.requestRow.projectId,
          name: "Unknown project",
          slug: null,
        },
    mode: input.requestRow.mode,
    provider:
      input.latestAttempt?.provider ??
      routingDecision.provider ??
      primaryOutcome?.provider ??
      null,
    model:
      input.latestAttempt?.modelId ??
      routingDecision.model ??
      primaryOutcome?.model ??
      null,
    status: resolvedStatus,
    latencyMs:
      input.latestAttempt?.latencyMs ?? primaryOutcome?.latencyMs ?? null,
    usage: deriveUsageSummary(input.usageRecord, primaryOutcome),
    cost: deriveCostSummary(input.usageRecord, primaryOutcome),
    selectionReason: deriveSelectionReason({
      routingDecision,
      primaryOutcome,
      latestAttempt: input.latestAttempt,
    }),
    issue: deriveIssueSummary({
      resolvedStatus,
      routingDecision,
      blockedOutcome,
      failedOutcome,
      latestAttempt: input.latestAttempt,
    }),
    primaryOutcome,
  };
}
