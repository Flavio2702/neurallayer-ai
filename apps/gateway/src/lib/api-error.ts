import type { ErrorType, GatewayErrorResponse } from "@neuralayer/core";

import { ZodError } from "zod";

interface GatewayApiErrorOptions {
  statusCode: number;
  type: ErrorType;
  code: string;
  message: string;
}

export class GatewayApiError extends Error {
  readonly statusCode: number;
  readonly type: ErrorType;
  readonly code: string;

  constructor(options: GatewayApiErrorOptions) {
    super(options.message);
    this.name = "GatewayApiError";
    this.statusCode = options.statusCode;
    this.type = options.type;
    this.code = options.code;
  }
}

export interface NormalizedGatewayError {
  statusCode: number;
  body: GatewayErrorResponse;
}

function createGatewayErrorResponse(
  error: GatewayApiError,
  requestId: string,
): GatewayErrorResponse {
  return {
    error: {
      type: error.type,
      code: error.code,
      message: error.message,
      request_id: requestId,
    },
  };
}

export function createGatewayApiError(options: GatewayApiErrorOptions) {
  return new GatewayApiError(options);
}

export function createAuthError(code: string, message: string) {
  return createGatewayApiError({
    statusCode: 401,
    type: "auth_error",
    code,
    message,
  });
}

export function createForbiddenError(code: string, message: string) {
  return createGatewayApiError({
    statusCode: 403,
    type: "forbidden",
    code,
    message,
  });
}

export function createInvalidRequestError(code: string, message: string) {
  return createGatewayApiError({
    statusCode: 400,
    type: "invalid_request",
    code,
    message,
  });
}

export function createInvalidProjectContextError() {
  return createInvalidRequestError(
    "missing_project_id",
    "No valid project context could be resolved for this request.",
  );
}

export function createPolicyBlockedError(
  code: string,
  message: string,
  statusCode = 403,
) {
  return createGatewayApiError({
    statusCode,
    type: "policy_blocked",
    code,
    message,
  });
}

export function normalizePolicyBlockedCode(code: string) {
  if (
    code === "policy_blocked_budget_cap" ||
    code === "workspace_budget_exceeded"
  ) {
    return "workspace_budget_exceeded";
  }

  return "policy_blocked";
}

export function normalizePolicyBlockedMessage(code: string, _message: string) {
  if (
    code === "policy_blocked_budget_cap" ||
    code === "workspace_budget_exceeded"
  ) {
    return "Blocked because the workspace monthly gateway-recorded budget cap has already been reached.";
  }

  if (code === "policy_blocked_no_eligible_candidate") {
    return "This request was blocked because no eligible provider or model could be selected for the current request.";
  }

  return "This request was blocked by the current workspace or project rules.";
}

export function createRateLimitError(code: string, message: string) {
  return createGatewayApiError({
    statusCode: 429,
    type: "rate_limit",
    code,
    message,
  });
}

export function createQuotaExceededError(code: string, message: string) {
  return createGatewayApiError({
    statusCode: 429,
    type: "quota_exceeded",
    code,
    message,
  });
}

export function createProviderUnavailableError(code: string, message: string) {
  return createGatewayApiError({
    statusCode: 503,
    type: "provider_unavailable",
    code,
    message,
  });
}

export function createTimeoutError(code: string, message: string) {
  return createGatewayApiError({
    statusCode: 504,
    type: "timeout",
    code,
    message,
  });
}

export function createNotSupportedError(code: string, message: string) {
  return createGatewayApiError({
    statusCode: 501,
    type: "not_supported",
    code,
    message,
  });
}

export function normalizeGatewayError(
  error: unknown,
  requestId: string,
): NormalizedGatewayError {
  if (error instanceof GatewayApiError) {
    return {
      statusCode: error.statusCode,
      body: createGatewayErrorResponse(error, requestId),
    };
  }

  if (error instanceof ZodError) {
    const gatewayError = createInvalidRequestError(
      "invalid_request",
      "Request validation failed.",
    );

    return {
      statusCode: gatewayError.statusCode,
      body: createGatewayErrorResponse(gatewayError, requestId),
    };
  }

  const unexpectedError = createGatewayApiError({
    statusCode: 500,
    type: "internal_error",
    code: "unexpected_gateway_error",
    message: "An unexpected gateway error occurred.",
  });

  return {
    statusCode: unexpectedError.statusCode,
    body: createGatewayErrorResponse(unexpectedError, requestId),
  };
}
