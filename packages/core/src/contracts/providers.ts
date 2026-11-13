import type {
  AttemptStatus,
  ErrorType,
  NormalizedProviderErrorType,
  ProviderName,
  RequestStatus,
} from "../enums";

import type { JsonObject } from "./common";
import type { NormalizedRequest, ResolvedContext } from "./requests";
import type { SelectedRoutingDecision } from "./routing";
import type { UsageRecord } from "./usage";

export interface NormalizedProviderError {
  type: NormalizedProviderErrorType;
  code?: string;
  message: string;
  retryable?: boolean;
  metadata?: JsonObject;
}

export interface ProviderExecutionRequest {
  request: NormalizedRequest;
  context: ResolvedContext;
  decision: SelectedRoutingDecision;
}

export interface ProviderExecutionResult {
  provider: ProviderName;
  model: string;
  requestStatus: RequestStatus;
  outputText?: string;
  finishReason?: string;
  usage?: UsageRecord;
  latencyMs?: number;
  responseId?: string;
  error?: NormalizedProviderError;
}

export interface ProviderAttempt {
  requestId: string;
  provider: ProviderName;
  model: string;
  status: AttemptStatus;
  startedAt: string;
  completedAt?: string;
  latencyMs?: number;
  errorType?: ErrorType;
  errorMessage?: string;
}
