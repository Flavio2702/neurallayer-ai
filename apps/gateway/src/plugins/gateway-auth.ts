import type { FastifyPluginAsync } from "fastify";

import { createAuthError, normalizeGatewayError } from "../lib/api-error";
import { logAuthFailed, logAuthSucceeded } from "../lib/logging";
import {
  type GatewayAuthService,
  parseBearerToken,
} from "../modules/auth/context";

export interface GatewayAuthPluginOptions {
  authService: GatewayAuthService;
}

export const gatewayAuthPlugin: FastifyPluginAsync<
  GatewayAuthPluginOptions
> = async (app, options) => {
  app.decorateRequest("gatewayAuth", null);

  app.addHook("onRequest", async (request) => {
    try {
      const apiKey = parseBearerToken(request.headers.authorization);
      const authContext = await options.authService.authenticateApiKey(apiKey, {
        now: new Date(),
      });

      if (!authContext) {
        throw createAuthError("invalid_api_key", "Invalid API key.");
      }

      request.gatewayAuth = authContext;
      logAuthSucceeded(request, authContext);
    } catch (error) {
      const normalizedError = normalizeGatewayError(error, request.id);

      logAuthFailed(request, normalizedError);
      throw error;
    }
  });
};
