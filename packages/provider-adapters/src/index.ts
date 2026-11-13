import type { ProviderName } from "@neuralayer/core";
import { createProviderRegistry } from "./contracts";
import { createAnthropicAdapter } from "./providers/anthropic";
import { createOpenAIAdapter } from "./providers/openai";

export * from "./connection-test";
export * from "./contracts";
export * from "./providers/anthropic";
export * from "./providers/openai";

const bootstrapProviderRegistry = createProviderRegistry([
  createOpenAIAdapter(),
  createAnthropicAdapter(),
]);

export function createBootstrapProviderRegistry() {
  return bootstrapProviderRegistry;
}

export function getProviderAdapter(providerName: ProviderName) {
  const adapter = bootstrapProviderRegistry.get(providerName);

  if (!adapter) {
    throw new Error(`Provider adapter not found for provider: ${providerName}`);
  }

  return adapter;
}

export function listBootstrapProviderNames() {
  return bootstrapProviderRegistry.list().map((adapter) => adapter.provider);
}
