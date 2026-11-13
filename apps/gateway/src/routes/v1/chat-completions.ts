import type { FastifyPluginAsync } from "fastify";

import { createNotSupportedError } from "../../lib/api-error";
import {
  parseChatCompletionBody,
  resolveEffectiveChatCompletionRequest,
} from "../../lib/schemas";
import { requireGatewayAuthContext } from "../../modules/auth/context";
import type { ChatCompletionsRuntime } from "../../modules/chat/runtime";

export interface ChatCompletionsRouteOptions {
  chatRuntime: ChatCompletionsRuntime;
}

export const chatCompletionsRoute: FastifyPluginAsync<
  ChatCompletionsRouteOptions
> = async (app, options) => {
  app.post("/chat/completions", async (request) => {
    const body = parseChatCompletionBody(request.body);
    const effectiveRequest = resolveEffectiveChatCompletionRequest(
      body,
      request.headers,
    );
    const authContext = requireGatewayAuthContext(request);

    if (effectiveRequest.stream) {
      throw createNotSupportedError(
        "streaming_not_enabled",
        "Streaming is not enabled for this gateway instance.",
      );
    }

    return options.chatRuntime.execute({
      requestId: request.id,
      authContext,
      effectiveRequest,
    });
  });
};
