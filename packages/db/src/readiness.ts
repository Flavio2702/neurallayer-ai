import { createConfiguredDbConnection } from "./client";

const DEFAULT_MAX_ATTEMPTS = 20;
const DEFAULT_RETRY_DELAY_MS = 1_000;

export interface DatabaseReadyResult {
  attempts: number;
}

export interface DatabaseRetryOptions {
  maxAttempts?: number;
  retryDelayMs?: number;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

export async function waitForConfiguredDatabaseReady(
  options: DatabaseRetryOptions = {},
): Promise<DatabaseReadyResult> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const { queryClient } = createConfiguredDbConnection();

    try {
      await queryClient`select 1`;

      return { attempts: attempt };
    } catch (error: unknown) {
      if (attempt === maxAttempts) {
        throw error;
      }

      console.log(
        `Database not ready yet (attempt ${attempt}/${maxAttempts}): ${getErrorMessage(error)}. Retrying in ${retryDelayMs}ms.`,
      );
      await sleep(retryDelayMs);
    } finally {
      await queryClient.end({ timeout: 5 }).catch(() => undefined);
    }
  }

  throw new Error(
    "Database readiness check exhausted without a terminal result.",
  );
}
