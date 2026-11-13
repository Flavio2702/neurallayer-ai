import type { FastifyPluginAsync } from "fastify";

import {
  createDatabaseGatewayAuthService,
  type GatewayAuthService,
} from "../../modules/auth/context";
import {
  type ChatCompletionsRuntime,
  createDefaultChatCompletionsRuntime,
} from "../../modules/chat/runtime";
import { gatewayAuthPlugin } from "../../plugins/gateway-auth";

import { chatCompletionsRoute } from "./chat-completions";
import { meRoute } from "./me";
import { modelsRoute } from "./models";

export interface V1RoutesOptions {
  authService?: GatewayAuthService;
  chatRuntime?: ChatCompletionsRuntime;
}

export const v1Routes: FastifyPluginAsync<V1RoutesOptions> = async (
  app,
  options,
) => {
  const authService = options.authService ?? createDatabaseGatewayAuthService();
  const chatRuntime =
    options.chatRuntime ??
    createDefaultChatCompletionsRuntime({
      authService,
      logger: app.log,
    });

  await gatewayAuthPlugin(app, { authService });
  await app.register(meRoute, { authService });
  await app.register(modelsRoute);
  await app.register(chatCompletionsRoute, { chatRuntime });
};
