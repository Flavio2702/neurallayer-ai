import type {
  ProviderExecutionRequest,
  ProviderExecutionResult,
} from "@neuralayer/core";

import {
  ProviderCredentialsResolutionError,
  resolveProviderAccountExecutionConfig,
  updateProviderAccountRuntimePosture,
} from "@neuralayer/db";
import { getProviderAdapter } from "@neuralayer/provider-adapters";

export interface ChatProviderExecutor {
  execute(input: ProviderExecutionRequest): Promise<ProviderExecutionResult>;
}

export interface ChatProviderExecutorDependencies {
  getAdapter?: typeof getProviderAdapter;
  loadProviderConfig?: typeof resolveProviderAccountExecutionConfig;
  updateProviderPosture?: typeof updateProviderAccountRuntimePosture;
}

function createMissingProviderConfigurationResult(
  input: ProviderExecutionRequest,
): ProviderExecutionResult {
  return {
    provider: input.decision.selected.provider,
    model: input.decision.selected.model,
    requestStatus: "failed",
    error: {
      type: "auth_error",
      code: "provider_configuration_missing",
      message:
        "No usable provider credentials are configured for this workspace.",
      retryable: false,
    },
  };
}

function createInvalidProviderConfigurationResult(
  input: ProviderExecutionRequest,
  message = "Configured provider credentials are invalid or unreadable for this workspace.",
): ProviderExecutionResult {
  return {
    provider: input.decision.selected.provider,
    model: input.decision.selected.model,
    requestStatus: "failed",
    error: {
      type: "auth_error",
      code: "invalid_provider_configuration",
      message,
      retryable: false,
    },
  };
}

export function createDatabaseChatProviderExecutor(
  dependencies: ChatProviderExecutorDependencies = {},
): ChatProviderExecutor {
  const getAdapter = dependencies.getAdapter ?? getProviderAdapter;
  const loadProviderConfig =
    dependencies.loadProviderConfig ?? resolveProviderAccountExecutionConfig;
  const updateProviderPosture =
    dependencies.updateProviderPosture ?? updateProviderAccountRuntimePosture;

  return {
    async execute(input) {
      let resolvedConfig: Awaited<
        ReturnType<typeof resolveProviderAccountExecutionConfig>
      > | null = null;

      try {
        resolvedConfig = await loadProviderConfig({
          workspaceId: input.context.workspaceId,
          provider: input.decision.selected.provider,
        });
      } catch (error) {
        if (!(error instanceof ProviderCredentialsResolutionError)) {
          throw error;
        }

        const result = createInvalidProviderConfigurationResult(
          input,
          error.message,
        );

        await updateProviderPosture({
          providerAccountId: error.providerAccountId,
          workspaceId: input.context.workspaceId,
          provider: input.decision.selected.provider,
          requestStatus: result.requestStatus,
          modelId: input.decision.selected.model,
          errorType: result.error?.type,
          errorCode: result.error?.code,
          errorMessage: result.error?.message,
        });

        return result;
      }

      if (!resolvedConfig) {
        const result = createMissingProviderConfigurationResult(input);

        await updateProviderPosture({
          workspaceId: input.context.workspaceId,
          provider: input.decision.selected.provider,
          requestStatus: result.requestStatus,
          modelId: input.decision.selected.model,
          errorType: result.error?.type,
          errorCode: result.error?.code,
          errorMessage: result.error?.message,
        });

        return result;
      }

      const adapter = getAdapter(input.decision.selected.provider);
      const configValidation = adapter.validateConfiguration(
        resolvedConfig.config,
      );

      if (!configValidation.ok) {
        const result = createInvalidProviderConfigurationResult(input);

        await updateProviderPosture({
          providerAccountId: resolvedConfig.providerAccountId,
          requestStatus: result.requestStatus,
          modelId: input.decision.selected.model,
          errorType: result.error?.type,
          errorCode: result.error?.code,
          errorMessage: result.error?.message,
        });

        return result;
      }

      try {
        const result = await adapter.execute(input, resolvedConfig.config);

        await updateProviderPosture({
          providerAccountId: resolvedConfig.providerAccountId,
          requestStatus: result.requestStatus,
          modelId: result.model,
          errorType: result.error?.type,
          errorCode: result.error?.code,
          errorMessage: result.error?.message,
          latencyMs: result.latencyMs ?? null,
          responseId: result.responseId,
        });

        return result;
      } catch (error) {
        await updateProviderPosture({
          providerAccountId: resolvedConfig.providerAccountId,
          requestStatus: "failed",
          modelId: input.decision.selected.model,
          errorType: "provider_unavailable",
          errorCode: "provider_execution_threw",
          errorMessage: "Provider execution failed unexpectedly.",
        });

        throw error;
      }
    },
  };
}

export function createBootstrapChatProviderExecutor() {
  return createDatabaseChatProviderExecutor();
}
