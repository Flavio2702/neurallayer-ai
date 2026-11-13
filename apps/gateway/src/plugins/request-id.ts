import type { FastifyInstance } from "fastify";

import { logRequestReceived } from "../lib/logging";

export function configureRequestId(app: FastifyInstance) {
  app.addHook("onRequest", async (request, reply) => {
    reply.header("x-request-id", request.id);
    logRequestReceived(request);
  });
}
