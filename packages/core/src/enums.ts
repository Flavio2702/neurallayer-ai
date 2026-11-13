export const PROVIDER_NAME_VALUES = ["openai", "anthropic"] as const;
export type ProviderName = (typeof PROVIDER_NAME_VALUES)[number];

export const BENCHMARK_SOURCE_NAME_VALUES = ["artificial_analysis"] as const;
export type BenchmarkSourceName = (typeof BENCHMARK_SOURCE_NAME_VALUES)[number];

export const MODE_VALUES = ["max_quality", "balanced", "budget"] as const;
export type Mode = (typeof MODE_VALUES)[number];

export const TASK_TYPE_VALUES = [
  "general",
  "code_generation",
  "code_review",
  "debugging",
  "documentation",
] as const;
export type TaskType = (typeof TASK_TYPE_VALUES)[number];

export const REQUEST_SOURCE_VALUES = [
  "api",
  "cli",
  "vscode_extension",
  "dashboard",
  "unknown",
] as const;
export type RequestSource = (typeof REQUEST_SOURCE_VALUES)[number];

export const POLICY_DECISION_TYPE_VALUES = ["allow", "warn", "block"] as const;
export type PolicyDecisionType = (typeof POLICY_DECISION_TYPE_VALUES)[number];

export const POLICY_ENFORCEMENT_MODE_VALUES = [
  "hard_block",
  "soft_warn",
] as const;
export type PolicyEnforcementMode =
  (typeof POLICY_ENFORCEMENT_MODE_VALUES)[number];

export const ATTEMPT_STATUS_VALUES = [
  "pending",
  "running",
  "succeeded",
  "failed",
  "timeout",
  "blocked",
] as const;
export type AttemptStatus = (typeof ATTEMPT_STATUS_VALUES)[number];

export const REQUEST_STATUS_VALUES = [
  "pending",
  "running",
  "succeeded",
  "failed",
  "blocked",
] as const;
export type RequestStatus = (typeof REQUEST_STATUS_VALUES)[number];

export const ERROR_TYPE_VALUES = [
  "auth_error",
  "forbidden",
  "invalid_request",
  "policy_blocked",
  "rate_limit",
  "quota_exceeded",
  "provider_unavailable",
  "timeout",
  "not_supported",
  "internal_error",
] as const;
export type ErrorType = (typeof ERROR_TYPE_VALUES)[number];

export const NORMALIZED_PROVIDER_ERROR_TYPE_VALUES = [
  "auth_error",
  "rate_limit",
  "quota_exceeded",
  "invalid_request",
  "provider_unavailable",
  "timeout",
  "unknown_provider_error",
] as const;
export type NormalizedProviderErrorType =
  (typeof NORMALIZED_PROVIDER_ERROR_TYPE_VALUES)[number];

export const CAPABILITY_CLASS_VALUES = [
  "general",
  "coding",
  "reasoning",
] as const;
export type CapabilityClass = (typeof CAPABILITY_CLASS_VALUES)[number];

export const COST_TIER_VALUES = ["low", "medium", "high"] as const;
export type CostTier = (typeof COST_TIER_VALUES)[number];

export const LATENCY_TIER_VALUES = ["fast", "medium", "slow"] as const;
export type LatencyTier = (typeof LATENCY_TIER_VALUES)[number];

export const MESSAGE_ROLE_VALUES = ["system", "user", "assistant"] as const;
export type MessageRole = (typeof MESSAGE_ROLE_VALUES)[number];

export const AUDIT_ACTOR_TYPE_VALUES = ["system", "user", "api_key"] as const;
export type AuditActorType = (typeof AUDIT_ACTOR_TYPE_VALUES)[number];

export const GATEWAY_RESPONSE_OBJECT_VALUES = ["chat.completion"] as const;
export type GatewayResponseObject =
  (typeof GATEWAY_RESPONSE_OBJECT_VALUES)[number];
