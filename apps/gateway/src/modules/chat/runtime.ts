import type {
  AuditEvent,
  GatewaySuccessResponse,
  JsonObject,
  NormalizedProviderError,
  NormalizedRequest,
  ProviderAttempt,
  ProviderExecutionResult,
  ProviderName,
  RequestStatus,
  ResolvedContext,
  SelectedRoutingDecision,
} from "@neuralayer/core";
import type { FastifyBaseLogger } from "fastify";

import {
  createInvalidProjectContextError,
  createInvalidRequestError,
  createPolicyBlockedError,
  createProviderUnavailableError,
  createQuotaExceededError,
  createRateLimitError,
  createTimeoutError,
  GatewayApiError,
  normalizePolicyBlockedCode,
  normalizePolicyBlockedMessage,
} from "../../lib/api-error";
import { logRouteInvocation } from "../../lib/logging";
import type { EffectiveChatCompletionRequest } from "../../lib/schemas";
import type { GatewayAuthContext, GatewayAuthService } from "../auth/context";

import {
  type ChatPersistence,
  createDatabaseChatPersistence,
  createNoopChatPersistence,
  type PersistedUsageSummary,
} from "./persistence";
import {
  type ChatProviderExecutor,
  createBootstrapChatProviderExecutor,
} from "./provider-executor";
import { type ChatRouter, createDatabaseChatRouter } from "./router";

export interface ChatCompletionsRuntimeInput {
  requestId: string;
  authContext: GatewayAuthContext;
  effectiveRequest: EffectiveChatCompletionRequest;
}

export interface ChatCompletionsRuntime {
  execute(input: ChatCompletionsRuntimeInput): Promise<GatewaySuccessResponse>;
}

export interface ChatCompletionsRuntimeDependencies {
  authService: GatewayAuthService;
  router: ChatRouter;
  providerExecutor: ChatProviderExecutor;
  persistence: ChatPersistence;
  logger?: Pick<FastifyBaseLogger, "info">;
}

const CHAT_COMPLETIONS_ROUTE_ID = "v1.chat.completions";
const CHAT_COMPLETIONS_ROUTE_URL = "/v1/chat/completions";

const noopLogger: Pick<FastifyBaseLogger, "info"> = {
  info() {
    return undefined;
  },
};

function buildNormalizedRequest(
  input: ChatCompletionsRuntimeInput,
  projectId: string,
): NormalizedRequest {
  return {
    stream: false,
    messages: input.effectiveRequest.messages,
    mode: input.effectiveRequest.mode,
    source: "api",
    requestId: input.requestId,
    projectId,
    taskType: input.effectiveRequest.taskType,
    metadata: input.effectiveRequest.metadata,
  };
}

function buildResolvedContext(
  input: ChatCompletionsRuntimeInput,
  projectId: string,
): ResolvedContext {
  return {
    workspaceId: input.authContext.workspaceId,
    projectId,
    mode: input.effectiveRequest.mode,
    source: "api",
    requestId: input.requestId,
    apiKeyId: input.authContext.apiKeyId,
    taskType: input.effectiveRequest.taskType,
  };
}

function mapProviderErrorToAttemptErrorType(error?: NormalizedProviderError) {
  switch (error?.type) {
    case "auth_error":
      return "auth_error";
    case "rate_limit":
      return "rate_limit";
    case "quota_exceeded":
      return "quota_exceeded";
    case "invalid_request":
      return "invalid_request";
    case "provider_unavailable":
    case "unknown_provider_error":
      return "provider_unavailable";
    case "timeout":
      return "timeout";
    default:
      return undefined;
  }
}

function mapProviderResultToAttemptStatus(
  result: ProviderExecutionResult,
): ProviderAttempt["status"] {
  if (result.requestStatus === "succeeded") {
    return "succeeded";
  }

  if (result.requestStatus === "blocked") {
    return "blocked";
  }

  if (result.error?.type === "timeout") {
    return "timeout";
  }

  return "failed";
}

function createAuditEvent(
  context: ResolvedContext,
  options: {
    eventType: string;
    message: string;
    requestStatus: RequestStatus;
    provider?: string;
    model?: string;
    errorType?: string;
    errorCode?: string;
    extraMetadata?: JsonObject;
  },
): AuditEvent {
  return {
    workspaceId: context.workspaceId,
    projectId: context.projectId,
    requestId: context.requestId,
    actorType: "api_key",
    eventType: options.eventType,
    message: options.message,
    createdAt: new Date().toISOString(),
    metadata: {
      request_status: options.requestStatus,
      provider: options.provider ?? null,
      model: options.model ?? null,
      error_type: options.errorType ?? null,
      error_code: options.errorCode ?? null,
      mode: context.mode,
      task_type: context.taskType ?? "general",
      ...(options.extraMetadata ?? {}),
    },
  };
}

function toAuditNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function extractBudgetAuditMetadata(
  decision:
    | SelectedRoutingDecision
    | {
        policyDecisions?: SelectedRoutingDecision["policyDecisions"];
        selectionReasonCode: string;
        selectionReasonText: string;
      },
): JsonObject {
  const metadata: JsonObject = {
    selection_reason_code: decision.selectionReasonCode,
    selection_reason_text: decision.selectionReasonText,
  };
  const budgetPolicyDecision = decision.policyDecisions?.find(
    (policyDecision) =>
      policyDecision.reasonCode === "policy_blocked_budget_cap",
  );
  const currentSpendUsd = toAuditNumber(
    budgetPolicyDecision?.metadata?.current_spend_usd,
  );
  const limitUsd = toAuditNumber(budgetPolicyDecision?.metadata?.limit_usd);

  if (typeof currentSpendUsd === "number") {
    metadata.current_spend_usd = currentSpendUsd;
  }

  if (typeof limitUsd === "number") {
    metadata.limit_usd = limitUsd;
  }

  if (typeof currentSpendUsd === "number" && typeof limitUsd === "number") {
    metadata.budget_remaining_usd = Math.max(limitUsd - currentSpendUsd, 0);
  }

  return metadata;
}

function buildBlockedAuditMetadata(decision: {
  policyDecisions?: SelectedRoutingDecision["policyDecisions"];
  selectionReasonCode: string;
  selectionReasonText: string;
}): JsonObject {
  return {
    ...extractBudgetAuditMetadata(decision),
    attempt_started: false,
    attempt_status: null,
    latency_ms: null,
    finish_reason: null,
    usage_recorded: false,
    cost_total_usd: 0,
    cost_unavailable: false,
  };
}

function buildUsageAuditMetadata(
  persistedUsageSummary: PersistedUsageSummary | null,
  usage: ProviderExecutionResult["usage"],
): JsonObject {
  if (persistedUsageSummary) {
    return {
      usage_recorded: true,
      usage_source: persistedUsageSummary.usageSource,
      input_tokens: persistedUsageSummary.inputTokens ?? null,
      output_tokens: persistedUsageSummary.outputTokens ?? null,
      total_tokens: persistedUsageSummary.totalTokens ?? null,
      cost_input_usd: persistedUsageSummary.costInputUsd ?? null,
      cost_output_usd: persistedUsageSummary.costOutputUsd ?? null,
      cost_total_usd: persistedUsageSummary.costTotalUsd ?? null,
      pricing_version: persistedUsageSummary.pricingVersion ?? null,
      currency: persistedUsageSummary.currency,
      cost_unavailable: false,
    };
  }

  if (!usage) {
    return {
      usage_recorded: false,
      cost_unavailable: true,
    };
  }

  return {
    usage_recorded: false,
    input_tokens: usage.inputTokens ?? null,
    output_tokens: usage.outputTokens ?? null,
    total_tokens: usage.totalTokens ?? null,
    cost_unavailable: true,
  };
}

function buildOutcomeAuditMetadata(input: {
  attemptStatus: ProviderAttempt["status"];
  result: ProviderExecutionResult;
  persistedUsageSummary: PersistedUsageSummary | null;
  selectionReasonCode: string;
  selectionReasonText: string;
}): JsonObject {
  return {
    selection_reason_code: input.selectionReasonCode,
    selection_reason_text: input.selectionReasonText,
    attempt_started: true,
    attempt_status: input.attemptStatus,
    latency_ms: input.result.latencyMs ?? null,
    finish_reason: input.result.finishReason ?? null,
    provider_request_status: input.result.requestStatus,
    ...buildUsageAuditMetadata(input.persistedUsageSummary, input.result.usage),
  };
}

function createAttempt(
  context: ResolvedContext,
  decision: SelectedRoutingDecision,
): ProviderAttempt {
  return {
    requestId: context.requestId,
    provider: decision.selected.provider,
    model: decision.selected.model,
    status: "running",
    startedAt: new Date().toISOString(),
  };
}

function finalizeAttempt(
  attempt: ProviderAttempt,
  result: ProviderExecutionResult,
): ProviderAttempt {
  return {
    ...attempt,
    provider: result.provider,
    model: result.model,
    status: mapProviderResultToAttemptStatus(result),
    completedAt: new Date().toISOString(),
    latencyMs: result.latencyMs,
    errorType: mapProviderErrorToAttemptErrorType(result.error),
    errorMessage: result.error?.message,
  };
}

function mapUnexpectedErrorToAttemptErrorType(error: unknown) {
  if (error instanceof GatewayApiError) {
    return error.type;
  }

  return "internal_error";
}

function mapUnexpectedErrorToAttemptStatus(
  error: unknown,
): ProviderAttempt["status"] {
  if (error instanceof GatewayApiError && error.type === "timeout") {
    return "timeout";
  }

  return "failed";
}

function getUnexpectedErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return "Provider execution threw an unexpected error.";
}

function getUnexpectedErrorCode(error: unknown) {
  if (error instanceof GatewayApiError) {
    return error.code;
  }

  return "provider_execution_threw";
}

function getUnexpectedErrorType(error: unknown) {
  if (error instanceof GatewayApiError) {
    return error.type;
  }

  return "internal_error";
}

function mapUnexpectedErrorToProviderError(
  error: unknown,
): NormalizedProviderError {
  if (error instanceof GatewayApiError) {
    switch (error.type) {
      case "auth_error":
        return {
          type: "auth_error",
          code: error.code,
          message: error.message,
        };
      case "rate_limit":
        return {
          type: "rate_limit",
          code: error.code,
          message: error.message,
        };
      case "quota_exceeded":
        return {
          type: "quota_exceeded",
          code: error.code,
          message: error.message,
        };
      case "invalid_request":
        return {
          type: "invalid_request",
          code: error.code,
          message: error.message,
        };
      case "timeout":
        return {
          type: "timeout",
          code: error.code,
          message: error.message,
        };
      default:
        return {
          type: "provider_unavailable",
          code: error.code,
          message: error.message,
        };
    }
  }

  return {
    type: "provider_unavailable",
    code: "provider_execution_threw",
    message: getUnexpectedErrorMessage(error),
  };
}

function finalizeAttemptFromUnexpectedError(
  attempt: ProviderAttempt,
  error: unknown,
): ProviderAttempt {
  return {
    ...attempt,
    status: mapUnexpectedErrorToAttemptStatus(error),
    completedAt: new Date().toISOString(),
    errorType: mapUnexpectedErrorToAttemptErrorType(error),
    errorMessage: getUnexpectedErrorMessage(error),
  };
}

function createUnexpectedProviderExecutionResult(
  decision: SelectedRoutingDecision,
  error: unknown,
): ProviderExecutionResult {
  return {
    provider: decision.selected.provider,
    model: decision.selected.model,
    requestStatus: "failed",
    finishReason: "execution_error",
    error: mapUnexpectedErrorToProviderError(error),
  };
}

function buildGatewaySuccessResponse(
  context: ResolvedContext,
  decision: SelectedRoutingDecision,
  result: ProviderExecutionResult,
  persistedUsageSummary: PersistedUsageSummary | null,
): GatewaySuccessResponse {
  const warnings = decision.warnings?.map((warning) => ({
    code: warning.code,
    message: warning.message,
  }));
  const gatewayCost =
    typeof result.usage?.costUsd === "number"
      ? {
          cost_usd: result.usage.costUsd,
          cost_source: "provider_reported" as const,
        }
      : typeof persistedUsageSummary?.costTotalUsd === "number"
        ? {
            cost_usd: persistedUsageSummary.costTotalUsd,
            cost_source: persistedUsageSummary.usageSource,
          }
        : undefined;

  return {
    id: context.requestId,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1_000),
    model: result.model,
    provider: result.provider,
    mode: context.mode,
    task_type: context.taskType ?? "general",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: result.outputText ?? "",
        },
        finish_reason: result.finishReason,
      },
    ],
    usage: result.usage
      ? {
          input_tokens: result.usage.inputTokens,
          output_tokens: result.usage.outputTokens,
          total_tokens: result.usage.totalTokens,
        }
      : undefined,
    meta: {
      workspace_id: context.workspaceId,
      project_id: context.projectId,
      latency_ms: result.latencyMs,
      selection_reason: {
        code: decision.selectionReasonCode,
        text: decision.selectionReasonText,
      },
      warnings: warnings && warnings.length > 0 ? warnings : undefined,
      cost_usd: gatewayCost?.cost_usd,
      cost_source: gatewayCost?.cost_source,
    },
  };
}

function createRoutingBlockedError(
  selectionReasonCode: string,
  selectionReasonText: string,
) {
  return createPolicyBlockedError(
    normalizePolicyBlockedCode(selectionReasonCode),
    normalizePolicyBlockedMessage(selectionReasonCode, selectionReasonText),
  );
}

function createProviderExecutionError(error: NormalizedProviderError) {
  switch (error.type) {
    case "rate_limit":
      return createRateLimitError(
        error.code ?? "provider_rate_limited",
        error.message,
      );
    case "quota_exceeded":
      return createQuotaExceededError(
        error.code ?? "provider_quota_exceeded",
        error.message,
      );
    case "invalid_request":
      return createInvalidRequestError(
        error.code ?? "invalid_provider_request",
        error.message,
      );
    case "timeout":
      return createTimeoutError(
        error.code ?? "provider_timeout",
        error.message,
      );
    case "auth_error":
      return createProviderUnavailableError(
        error.code ?? "provider_auth_failed",
        error.message,
      );
    case "provider_unavailable":
      return createProviderUnavailableError(
        error.code ?? "provider_unavailable",
        error.message,
      );
    case "unknown_provider_error":
    default:
      return createProviderUnavailableError(
        error.code === "not_implemented"
          ? "provider_runtime_not_ready"
          : (error.code ?? "provider_unavailable"),
        error.code === "not_implemented"
          ? "Provider runtime is not ready for this gateway instance."
          : error.message,
      );
  }
}

function logChatCompletionRoute(
  logger: Pick<FastifyBaseLogger, "info">,
  context: ResolvedContext,
  input: ChatCompletionsRuntimeInput,
  options: {
    provider?: ProviderName;
    model?: string;
  } = {},
) {
  logRouteInvocation(logger, {
    requestId: input.requestId,
    routeId: CHAT_COMPLETIONS_ROUTE_ID,
    route: CHAT_COMPLETIONS_ROUTE_URL,
    workspaceId: context.workspaceId,
    projectId: context.projectId,
    apiKeyId: context.apiKeyId,
    mode: context.mode,
    taskType: context.taskType,
    stream: input.effectiveRequest.stream,
    provider: options.provider,
    model: options.model,
    method: "POST",
    url: CHAT_COMPLETIONS_ROUTE_URL,
  });
}

export function createChatCompletionsRuntime(
  dependencies: ChatCompletionsRuntimeDependencies,
): ChatCompletionsRuntime {
  const logger = dependencies.logger ?? noopLogger;

  return {
    async execute(input) {
      const resolvedProject = await dependencies.authService.resolveProject(
        input.authContext,
        input.effectiveRequest.projectId,
      );

      if (!resolvedProject) {
        throw createInvalidProjectContextError();
      }

      const normalizedRequest = buildNormalizedRequest(
        input,
        resolvedProject.id,
      );
      const context = buildResolvedContext(input, resolvedProject.id);
      let requestStarted = false;
      let requestCompleted = false;
      let selectedDecision: SelectedRoutingDecision | null = null;
      let startedAttempt: ProviderAttempt | null = null;
      let attemptCompleted = false;

      try {
        await dependencies.persistence.recordRequestStarted({
          request: normalizedRequest,
          context,
        });
        requestStarted = true;

        const decision = await dependencies.router.route({
          request: normalizedRequest,
          context,
        });
        await dependencies.persistence.recordRoutingDecision({
          request: normalizedRequest,
          context,
          decision,
        });

        if (decision.outcome === "blocked") {
          logChatCompletionRoute(logger, context, input);

          await dependencies.persistence.recordAuditEvent({
            request: normalizedRequest,
            context,
            auditEvent: createAuditEvent(context, {
              eventType: "chat.completions.blocked",
              message: decision.selectionReasonText,
              requestStatus: "blocked",
              errorType: "policy_blocked",
              errorCode: decision.selectionReasonCode,
              extraMetadata: buildBlockedAuditMetadata(decision),
            }),
          });

          await dependencies.persistence.recordRequestCompleted({
            request: normalizedRequest,
            context,
            status: "blocked",
          });
          requestCompleted = true;

          throw createRoutingBlockedError(
            decision.selectionReasonCode,
            decision.selectionReasonText,
          );
        }

        selectedDecision = decision;
        startedAttempt = createAttempt(context, decision);

        await dependencies.persistence.recordAttemptStarted({
          request: normalizedRequest,
          context,
          decision,
          attempt: startedAttempt,
        });

        const result = await dependencies.providerExecutor.execute({
          request: normalizedRequest,
          context,
          decision,
        });
        const requestStatus = result.requestStatus;

        const completedAttempt = finalizeAttempt(startedAttempt, result);

        await dependencies.persistence.recordAttemptCompleted({
          request: normalizedRequest,
          context,
          decision,
          attempt: completedAttempt,
          result,
        });
        attemptCompleted = true;

        const persistedUsageSummary = result.usage
          ? await dependencies.persistence.recordUsage({
              request: normalizedRequest,
              context,
              decision,
              usage: result.usage,
            })
          : null;

        logChatCompletionRoute(logger, context, input, {
          provider: result.provider,
          model: result.model,
        });

        await dependencies.persistence.recordAuditEvent({
          request: normalizedRequest,
          context,
          auditEvent: createAuditEvent(context, {
            eventType:
              requestStatus === "succeeded"
                ? "chat.completions.completed"
                : "chat.completions.failed",
            message:
              requestStatus === "succeeded"
                ? "Chat completion executed successfully."
                : (result.error?.message ??
                  "Chat completion failed during provider execution."),
            requestStatus,
            provider: result.provider,
            model: result.model,
            errorType: result.error?.type,
            errorCode: result.error?.code,
            extraMetadata: buildOutcomeAuditMetadata({
              attemptStatus: completedAttempt.status,
              result,
              persistedUsageSummary,
              selectionReasonCode: decision.selectionReasonCode,
              selectionReasonText: decision.selectionReasonText,
            }),
          }),
        });
        await dependencies.persistence.recordRequestCompleted({
          request: normalizedRequest,
          context,
          status: requestStatus,
        });
        requestCompleted = true;

        if (requestStatus === "succeeded") {
          return buildGatewaySuccessResponse(
            context,
            decision,
            result,
            persistedUsageSummary,
          );
        }

        throw createProviderExecutionError(
          result.error ?? {
            type: "unknown_provider_error",
            code: "provider_unavailable",
            message: "Provider execution failed without a normalized error.",
          },
        );
      } catch (error) {
        if (requestStarted && !requestCompleted) {
          if (selectedDecision && startedAttempt && !attemptCompleted) {
            await dependencies.persistence.recordAttemptCompleted({
              request: normalizedRequest,
              context,
              decision: selectedDecision,
              attempt: finalizeAttemptFromUnexpectedError(
                startedAttempt,
                error,
              ),
              result: createUnexpectedProviderExecutionResult(
                selectedDecision,
                error,
              ),
            });
            attemptCompleted = true;
          }

          logChatCompletionRoute(logger, context, input, {
            provider: selectedDecision?.selected.provider,
            model: selectedDecision?.selected.model,
          });

          await dependencies.persistence.recordAuditEvent({
            request: normalizedRequest,
            context,
            auditEvent: createAuditEvent(context, {
              eventType: "chat.completions.failed",
              message: getUnexpectedErrorMessage(error),
              requestStatus: "failed",
              provider: selectedDecision?.selected.provider,
              model: selectedDecision?.selected.model,
              errorType: getUnexpectedErrorType(error),
              errorCode: getUnexpectedErrorCode(error),
            }),
          });

          await dependencies.persistence.recordRequestCompleted({
            request: normalizedRequest,
            context,
            status: "failed",
          });
          requestCompleted = true;
        }

        throw error;
      }
    },
  };
}

export function createDefaultChatCompletionsRuntime(options: {
  authService: GatewayAuthService;
  logger?: Pick<FastifyBaseLogger, "info">;
}) {
  return createChatCompletionsRuntime({
    authService: options.authService,
    router: createDatabaseChatRouter(),
    providerExecutor: createBootstrapChatProviderExecutor(),
    persistence: createDatabaseChatPersistence(),
    logger: options.logger,
  });
}
