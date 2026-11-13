import type { FastifyPluginAsync } from "fastify";

import { logRouteInvoked } from "../../lib/logging";
import { parseModelsQuery } from "../../lib/schemas";
import { requireGatewayAuthContext } from "../../modules/auth/context";
import { listVisibleModels } from "../../modules/models/catalog";

export const modelsRoute: FastifyPluginAsync = async (app) => {
  app.get("/models", async (request) => {
    const authContext = requireGatewayAuthContext(request);

    const query = parseModelsQuery(request.query);
    logRouteInvoked(request, {
      routeId: "v1.models",
      workspaceId: authContext.workspaceId,
      apiKeyId: authContext.apiKeyId,
      providerFilter: query.provider,
      mode: query.mode,
      taskType: query.task_type,
    });

    const models = await listVisibleModels({
      provider: query.provider,
      mode: query.mode,
      taskType: query.task_type,
    });

    return {
      data: models,
    };
  });
};
