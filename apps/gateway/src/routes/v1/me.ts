import type { FastifyPluginAsync } from "fastify";

import { logRouteInvoked } from "../../lib/logging";
import {
  type GatewayAuthService,
  requireGatewayAuthContext,
} from "../../modules/auth/context";

export interface MeRouteOptions {
  authService: GatewayAuthService;
}

export const meRoute: FastifyPluginAsync<MeRouteOptions> = async (
  app,
  options,
) => {
  app.get("/me", async (request) => {
    const authContext = requireGatewayAuthContext(request);
    const context = await options.authService.loadMeContext(authContext);

    logRouteInvoked(request, {
      routeId: "v1.me",
      workspaceId: authContext.workspaceId,
      projectId: context.project?.id,
      apiKeyId: authContext.apiKeyId,
    });

    return {
      workspace: {
        id: context.workspace.id,
        name: context.workspace.name,
      },
      project: context.project
        ? {
            id: context.project.id,
            name: context.project.name,
          }
        : null,
      available_modes: [...context.availableModes],
      available_task_types: [...context.availableTaskTypes],
      providers_configured: context.providersConfigured,
    };
  });
};
