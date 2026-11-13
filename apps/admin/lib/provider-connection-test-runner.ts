import {
  createAnthropicAdapter,
  createOpenAIAdapter,
  createProviderConnectionTestRunner,
  getProviderAdapter,
} from "@neuralayer/provider-adapters";

function readOptionalUrlEnv(value: string | undefined) {
  const normalizedValue = value?.trim();

  return normalizedValue && normalizedValue.length > 0 ? normalizedValue : null;
}

export function createAdminProviderConnectionTestRunner() {
  const openAiBaseUrl = readOptionalUrlEnv(
    process.env.ADMIN_SMOKE_PROVIDER_TEST_OPENAI_BASE_URL,
  );
  const anthropicBaseUrl = readOptionalUrlEnv(
    process.env.ADMIN_SMOKE_PROVIDER_TEST_ANTHROPIC_BASE_URL,
  );

  if (!openAiBaseUrl && !anthropicBaseUrl) {
    return createProviderConnectionTestRunner();
  }

  return createProviderConnectionTestRunner({
    getAdapter(provider) {
      switch (provider) {
        case "openai":
          return openAiBaseUrl
            ? createOpenAIAdapter({
                baseUrl: openAiBaseUrl,
              })
            : getProviderAdapter(provider);
        case "anthropic":
          return anthropicBaseUrl
            ? createAnthropicAdapter({
                baseUrl: anthropicBaseUrl,
              })
            : getProviderAdapter(provider);
        default:
          return getProviderAdapter(provider);
      }
    },
  });
}
