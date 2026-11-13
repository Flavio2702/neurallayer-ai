import { randomUUID } from "node:crypto";
import { type GatewayConfig, loadGatewayConfig } from "@neuralayer/config";
import type { FastifyInstance, FastifyServerOptions } from "fastify";
import Fastify from "fastify";

import type { GatewayAuthService } from "./modules/auth/context";
import type { ChatCompletionsRuntime } from "./modules/chat/runtime";
import { configureErrorHandler } from "./plugins/errors";
import { configureRequestId } from "./plugins/request-id";
import { registerRoutes } from "./routes";

function resolveRequestId(headerValue: string | string[] | undefined) {
  if (typeof headerValue === "string" && headerValue.trim().length > 0) {
    return headerValue.trim();
  }

  if (Array.isArray(headerValue)) {
    const preferredHeaderValue = headerValue.find(
      (value) => value.trim().length > 0,
    );

    if (preferredHeaderValue) {
      return preferredHeaderValue.trim();
    }
  }

  return randomUUID();
}

export interface GatewayAppOptions {
  config?: GatewayConfig;
  authService?: GatewayAuthService;
  chatRuntime?: ChatCompletionsRuntime;
  logger?: FastifyServerOptions["logger"];
  loggerInstance?: FastifyServerOptions["loggerInstance"];
}

export function createGatewayApp(options: GatewayAppOptions = {}) {
  const config = options.config ?? loadGatewayConfig();
  const logger =
    options.logger ??
    (options.loggerInstance
      ? undefined
      : {
          level: config.logLevel,
        });
  const app = Fastify({
    disableRequestLogging: true,
    ...(typeof logger === "undefined" ? {} : { logger }),
    ...(options.loggerInstance
      ? { loggerInstance: options.loggerInstance }
      : {}),
    genReqId: (request) => resolveRequestId(request.headers["x-request-id"]),
  });

  configureRequestId(app as FastifyInstance);
  configureErrorHandler(app as FastifyInstance);
  app.register(registerRoutes, {
    authService: options.authService,
    chatRuntime: options.chatRuntime,
  });

  return app;
}
