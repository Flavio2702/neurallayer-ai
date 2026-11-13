import type { RequestRuntimeProjectSummary } from "./request-runtime-lineage";
import { toOptionalNumber, toOptionalString } from "./request-runtime-lineage";

export interface AuditEventSummaryInput {
  eventType: string;
  eventPayload: Record<string, unknown> | null | undefined;
}

export interface NormalizedAuditEventFields {
  message: string | null;
  provider: string | null;
  model: string | null;
  requestStatus: string | null;
  errorType: string | null;
  errorCode: string | null;
  costTotalUsd: number | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getAuditMetadata(payload: Record<string, unknown> | null | undefined) {
  return isRecord(payload?.metadata) ? payload.metadata : null;
}

function getRoutingDecisionSelected(
  payload: Record<string, unknown> | null | undefined,
) {
  if (!isRecord(payload)) {
    return null;
  }

  const routingDecision = isRecord(payload.routing_decision)
    ? payload.routing_decision
    : null;
  const selected = isRecord(routingDecision?.selected)
    ? routingDecision.selected
    : null;

  return selected;
}

export function normalizeAuditEventFields(
  input: AuditEventSummaryInput,
): NormalizedAuditEventFields {
  const payload = isRecord(input.eventPayload) ? input.eventPayload : null;
  const metadata = getAuditMetadata(payload);
  const routingSelected = getRoutingDecisionSelected(payload);

  return {
    message: toOptionalString(payload?.message),
    provider:
      toOptionalString(metadata?.provider) ??
      toOptionalString(payload?.provider) ??
      toOptionalString(routingSelected?.provider),
    model:
      toOptionalString(metadata?.model) ??
      toOptionalString(payload?.model) ??
      toOptionalString(routingSelected?.model),
    requestStatus: toOptionalString(metadata?.request_status),
    errorType: toOptionalString(metadata?.error_type),
    errorCode: toOptionalString(metadata?.error_code),
    costTotalUsd: toOptionalNumber(metadata?.cost_total_usd),
  };
}

export function formatAuditErrorSummary(input: {
  errorCode: string | null;
  errorType: string | null;
}) {
  if (input.errorCode && input.errorType) {
    return `${input.errorCode} / ${input.errorType}`;
  }

  return input.errorCode ?? input.errorType ?? "";
}

export function getAuditProjectLabel(
  project: RequestRuntimeProjectSummary | null,
) {
  return project?.name ?? "Workspace scope";
}
