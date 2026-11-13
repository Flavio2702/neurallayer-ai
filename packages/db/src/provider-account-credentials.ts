import type { ProviderName } from "@neuralayer/core";
import { and, asc, eq } from "drizzle-orm";

import type { Database } from "./client";
import { withDatabase } from "./connection-helpers";
import {
  decryptProviderCredentials,
  parseProviderCredentialsEnvelope,
} from "./provider-credentials-crypto";

const DEMO_PROVIDER_CREDENTIAL_PREFIX = "demo-placeholder-";
const INVALID_PROVIDER_CONFIGURATION_CODE = "invalid_provider_configuration";
const INVALID_PROVIDER_CONFIGURATION_MESSAGE =
  "Configured provider credentials are invalid or unreadable for this workspace.";

export interface StoredProviderCredentialConfig {
  apiKey: string;
}

export type StoredProviderCredentialState =
  | "missing"
  | "placeholder"
  | "stored";

export class ProviderCredentialsResolutionError extends Error {
  readonly code = INVALID_PROVIDER_CONFIGURATION_CODE;
  readonly providerAccountId?: string;

  constructor(input: { providerAccountId?: string; message?: string } = {}) {
    super(input.message ?? INVALID_PROVIDER_CONFIGURATION_MESSAGE);
    this.name = "ProviderCredentialsResolutionError";
    this.providerAccountId = input.providerAccountId;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDemoProviderCredentialPlaceholder(
  encryptedCredentials: string | null | undefined,
) {
  return (
    encryptedCredentials?.trim().startsWith(DEMO_PROVIDER_CREDENTIAL_PREFIX) ??
    false
  );
}

function createProviderCredentialsResolutionError(providerAccountId?: string) {
  return new ProviderCredentialsResolutionError({
    providerAccountId,
  });
}

function normalizeStoredApiKey(
  value: unknown,
  providerAccountId?: string,
): StoredProviderCredentialConfig {
  if (typeof value !== "string") {
    throw createProviderCredentialsResolutionError(providerAccountId);
  }

  const apiKey = value.trim();

  if (apiKey.length === 0) {
    throw createProviderCredentialsResolutionError(providerAccountId);
  }

  return {
    apiKey,
  };
}

function resolveLegacyStoredProviderCredentials(
  encryptedCredentials: string,
  providerAccountId?: string,
) {
  let parsedValue: unknown;

  try {
    parsedValue = JSON.parse(encryptedCredentials);
  } catch {
    return normalizeStoredApiKey(encryptedCredentials, providerAccountId);
  }

  if (typeof parsedValue === "string") {
    return normalizeStoredApiKey(parsedValue, providerAccountId);
  }

  if (!isRecord(parsedValue)) {
    throw createProviderCredentialsResolutionError(providerAccountId);
  }

  return normalizeStoredApiKey(parsedValue.apiKey, providerAccountId);
}

function resolveStoredProviderCredentialsForRuntime(
  encryptedCredentials: string | null | undefined,
  providerAccountId?: string,
): StoredProviderCredentialConfig | null {
  const trimmedValue = encryptedCredentials?.trim();

  if (!trimmedValue || isDemoProviderCredentialPlaceholder(trimmedValue)) {
    return null;
  }

  if (parseProviderCredentialsEnvelope(trimmedValue)) {
    try {
      const decryptedPayload = decryptProviderCredentials(trimmedValue);

      return normalizeStoredApiKey(decryptedPayload.apiKey, providerAccountId);
    } catch {
      throw createProviderCredentialsResolutionError(providerAccountId);
    }
  }

  return resolveLegacyStoredProviderCredentials(
    trimmedValue,
    providerAccountId,
  );
}

export function hasUsableStoredProviderCredentials(
  encryptedCredentials: string | null | undefined,
) {
  const trimmedValue = encryptedCredentials?.trim();

  if (!trimmedValue || isDemoProviderCredentialPlaceholder(trimmedValue)) {
    return false;
  }

  if (parseProviderCredentialsEnvelope(trimmedValue)) {
    return true;
  }

  try {
    resolveLegacyStoredProviderCredentials(trimmedValue);
    return true;
  } catch {
    return false;
  }
}

export function getStoredProviderCredentialState(
  encryptedCredentials: string | null | undefined,
): StoredProviderCredentialState {
  const trimmedValue = encryptedCredentials?.trim();

  if (!trimmedValue) {
    return "missing";
  }

  if (isDemoProviderCredentialPlaceholder(trimmedValue)) {
    return "placeholder";
  }

  return hasUsableStoredProviderCredentials(trimmedValue)
    ? "stored"
    : "missing";
}

export async function resolveProviderAccountExecutionConfig(
  input: {
    workspaceId: string;
    provider: ProviderName;
  },
  database?: Database,
) {
  return withDatabase(database, async (db) => {
    const accounts = await db.query.providerAccounts.findMany({
      where: (table) =>
        and(
          eq(table.workspaceId, input.workspaceId),
          eq(table.provider, input.provider),
          eq(table.status, "active"),
        ),
      orderBy: (table) => [asc(table.displayName), asc(table.id)],
    });
    let firstResolutionError: ProviderCredentialsResolutionError | null = null;

    for (const account of accounts) {
      try {
        const credentials = resolveStoredProviderCredentialsForRuntime(
          account.encryptedCredentials,
          account.id,
        );

        if (!credentials) {
          continue;
        }

        return {
          providerAccountId: account.id,
          displayName: account.displayName,
          config: credentials,
        };
      } catch (error) {
        if (error instanceof ProviderCredentialsResolutionError) {
          firstResolutionError ??= error;
          continue;
        }

        throw error;
      }
    }

    if (firstResolutionError) {
      throw firstResolutionError;
    }

    return null;
  });
}
