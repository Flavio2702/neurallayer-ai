import type { Mode, ProviderName, TaskType } from "@neuralayer/core";
import type { FastifyBaseLogger, FastifyRequest } from "fastify";

import type { GatewayAuthContext } from "../modules/auth/context";

import type { NormalizedGatewayError } from "./api-error";

interface RequestLogEnvelope {
  requestId: string;
  method: string;
  url: string;
  route?: string;
}

interface RouteInvocationDetails {
  routeId: string;
  workspaceId?: string;
  projectId?: string;
  apiKeyId?: string;
  provider?: ProviderName;
  model?: string;
  mode?: Mode;
  taskType?: TaskType;
  providerFilter?: ProviderName;
  stream?: boolean;
}

interface RouteInvocationEnvelope
  extends RequestLogEnvelope,
    RouteInvocationDetails {}

function getRoute(request: FastifyRequest) {
  const route = request.routeOptions.url;

  return typeof route === "string" ? route : undefined;
}

function buildRequestLogEnvelope(request: FastifyRequest): RequestLogEnvelope {
  return {
    requestId: request.id,
    method: request.method,
    url: request.url,
    route: getRoute(request),
  };
}

export function logRequestReceived(request: FastifyRequest) {
  request.log.info(buildRequestLogEnvelope(request), "request received");
}

export function logAuthSucceeded(
  request: FastifyRequest,
  authContext: GatewayAuthContext,
) {
  request.log.info(
    {
      ...buildRequestLogEnvelope(request),
      workspaceId: authContext.workspaceId,
      apiKeyId: authContext.apiKeyId,
      defaultProjectId: authContext.defaultProjectId,
    },
    "auth result",
  );
}

export function logAuthFailed(
  request: FastifyRequest,
  normalizedError: NormalizedGatewayError,
) {
  request.log.warn(
    {
      ...buildRequestLogEnvelope(request),
      statusCode: normalizedError.statusCode,
      errorType: normalizedError.body.error.type,
      errorCode: normalizedError.body.error.code,
    },
    "auth result",
  );
}

export function logRouteInvoked(
  request: FastifyRequest,
  details: RouteInvocationDetails,
) {
  logRouteInvocation(request.log, {
    ...buildRequestLogEnvelope(request),
    ...details,
  });
}

export function logRouteInvocation(
  logger: Pick<FastifyBaseLogger, "info">,
  envelope: RouteInvocationEnvelope,
) {
  logger.info(envelope, "route invoked");
}

export function logErrorRaised(
  request: FastifyRequest,
  error: unknown,
  normalizedError: NormalizedGatewayError,
) {
  const payload = {
    ...buildRequestLogEnvelope(request),
    statusCode: normalizedError.statusCode,
    errorType: normalizedError.body.error.type,
    errorCode: normalizedError.body.error.code,
  };

  if (normalizedError.statusCode >= 500) {
    request.log.error(
      {
        ...payload,
        stack: error instanceof Error ? error.stack : undefined,
      },
      "error raised",
    );

    return;
  }

  request.log.warn(payload, "error raised");
}
