import type { FastifyInstance } from "fastify";
import { normalizeGatewayError } from "../lib/api-error";
import { logErrorRaised } from "../lib/logging";

export function configureErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((error, request, reply) => {
    const normalizedError = normalizeGatewayError(error, request.id);

    logErrorRaised(request, error, normalizedError);
    void reply.code(normalizedError.statusCode).send(normalizedError.body);
  });
}
