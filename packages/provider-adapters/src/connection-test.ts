import type {
  ProviderConnectionTestInput,
  ProviderConnectionTestRunner,
} from "./contracts";

import { getProviderAdapter } from "./index";

export interface ProviderConnectionTestRunnerDependencies {
  getAdapter?: typeof getProviderAdapter;
}

const PROVIDER_CONNECTION_TEST_MESSAGE = "Reply with the single word ok.";
const PROVIDER_CONNECTION_TEST_PROJECT_ID = "proj_provider_connection_test";
const PROVIDER_CONNECTION_TEST_API_KEY_ID = "provider_connection_test";
const PROVIDER_CONNECTION_TEST_WORKSPACE_ID = "ws_provider_connection_test";

export function createProviderConnectionTestRunner(
  dependencies: ProviderConnectionTestRunnerDependencies = {},
): ProviderConnectionTestRunner {
  const getAdapter = dependencies.getAdapter ?? getProviderAdapter;

  return {
    async run(input) {
      const adapter = getAdapter(input.provider);

      return adapter.execute(
        {
          request: {
            stream: false,
            messages: [
              {
                role: "user",
                content: PROVIDER_CONNECTION_TEST_MESSAGE,
              },
            ],
            mode: "balanced",
            source: "dashboard",
            requestId: input.requestId,
            projectId: PROVIDER_CONNECTION_TEST_PROJECT_ID,
            taskType: "general",
          },
          context: {
            workspaceId: PROVIDER_CONNECTION_TEST_WORKSPACE_ID,
            projectId: PROVIDER_CONNECTION_TEST_PROJECT_ID,
            mode: "balanced",
            source: "dashboard",
            requestId: input.requestId,
            apiKeyId: PROVIDER_CONNECTION_TEST_API_KEY_ID,
            taskType: "general",
          },
          decision: {
            outcome: "selected",
            selected: {
              provider: input.provider,
              model: input.model,
            },
            selectionReasonCode: "provider_connection_test",
            selectionReasonText:
              "Selected by the provider connection test runner.",
          },
        },
        input.config,
      );
    },
  };
}
