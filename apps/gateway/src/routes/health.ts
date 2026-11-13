import type { FastifyPluginAsync } from "fastify";

import { logRouteInvoked } from "../lib/logging";

export const healthRoute: FastifyPluginAsync = async (app) => {
  app.get("/health", async (request) => {
    logRouteInvoked(request, {
      routeId: "health",
    });

    return {
      status: "ok",
      service: "gateway",
      version: "v1",
    };
  });
};
