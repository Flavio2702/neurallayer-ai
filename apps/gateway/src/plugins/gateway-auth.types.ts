import "fastify";

import type { GatewayAuthContext } from "../modules/auth/context";

declare module "fastify" {
  interface FastifyRequest {
    gatewayAuth: GatewayAuthContext | null;
  }
}
