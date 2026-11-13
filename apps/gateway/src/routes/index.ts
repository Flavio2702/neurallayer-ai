import type { FastifyPluginAsync } from "fastify";

import type { GatewayAuthService } from "../modules/auth/context";
import type { ChatCompletionsRuntime } from "../modules/chat/runtime";

import { healthRoute } from "./health";
import { v1Routes } from "./v1";

export interface RegisterRoutesOptions {
  authService?: GatewayAuthService;
  chatRuntime?: ChatCompletionsRuntime;
}

export const registerRoutes: FastifyPluginAsync<RegisterRoutesOptions> = async (
  app,
  options,
) => {
  await app.register(healthRoute);
  await app.register(v1Routes, {
    prefix: "/v1",
    authService: options.authService,
    chatRuntime: options.chatRuntime,
  });
};
