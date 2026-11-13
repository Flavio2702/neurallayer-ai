import { loadGatewayConfig } from "@neuralayer/config";

import { createGatewayApp } from "./app";

async function main() {
  const config = loadGatewayConfig();
  const app = createGatewayApp({ config });

  try {
    await app.listen({
      host: config.gateway.host,
      port: config.gateway.port,
    });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

void main();
