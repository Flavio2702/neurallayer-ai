import {
  MODE_VALUES,
  type Mode,
  type ProviderName,
  TASK_TYPE_VALUES,
  type TaskType,
} from "@neuralayer/core";
import {
  createConfiguredDbConnection,
  type Database,
  hashGatewayApiKey,
  listActiveWorkspaceProviderAccounts,
  touchGatewayApiKeyLastUsedAt,
} from "@neuralayer/db";

import {
  createAuthError,
  createForbiddenError,
  createGatewayApiError,
} from "../../lib/api-error";
import { getHeaderValue } from "../../lib/headers";

export interface GatewayAuthContext {
  workspaceId: string;
  apiKeyId: string;
  defaultProjectId?: string;
}

export interface GatewayProjectContext {
  id: string;
  name: string;
}

export interface GatewayMeContext {
  workspace: {
    id: string;
    name: string;
  };
  project: GatewayProjectContext | null;
  availableModes: readonly Mode[];
  availableTaskTypes: readonly TaskType[];
  providersConfigured: ProviderName[];
}

export interface GatewayAuthService {
  authenticateApiKey(
    apiKey: string,
    input?: {
      now?: Date;
    },
  ): Promise<GatewayAuthContext | null>;
  loadMeContext(authContext: GatewayAuthContext): Promise<GatewayMeContext>;
  resolveProject(
    authContext: GatewayAuthContext,
    requestedProjectId?: string,
  ): Promise<GatewayProjectContext | null>;
}

async function withConfiguredDatabase<T>(
  operation: (database: Database) => Promise<T>,
): Promise<T> {
  const { db, queryClient } = createConfiguredDbConnection();

  try {
    return await operation(db);
  } finally {
    await queryClient.end({ timeout: 5 }).catch(() => undefined);
  }
}

async function listConfiguredProviders(
  database: Database,
  workspaceId: string,
) {
  const providerAccounts = await listActiveWorkspaceProviderAccounts(
    workspaceId,
    database,
  );

  return [
    ...new Set(
      providerAccounts.map((providerAccount) => providerAccount.provider),
    ),
  ];
}

async function loadActiveProject(
  database: Database,
  workspaceId: string,
  projectId?: string,
): Promise<GatewayProjectContext | null> {
  if (!projectId) {
    return null;
  }

  const project = await database.query.projects.findFirst({
    where: (projects, { and, eq }) =>
      and(eq(projects.id, projectId), eq(projects.workspaceId, workspaceId)),
  });

  if (!project || project.status !== "active") {
    return null;
  }

  return {
    id: project.id,
    name: project.name,
  };
}

async function authenticateApiKeyFromDatabase(
  database: Database,
  apiKey: string,
  now: Date,
): Promise<GatewayAuthContext | null> {
  const apiKeyRecord = await database.query.gatewayApiKeys.findFirst({
    where: (gatewayApiKeys, { eq }) =>
      eq(gatewayApiKeys.keyHash, hashGatewayApiKey(apiKey)),
    with: {
      workspace: true,
    },
  });

  if (!apiKeyRecord) {
    return null;
  }

  if (apiKeyRecord.status === "revoked") {
    throw createForbiddenError(
      "revoked_api_key",
      "The provided API key has been revoked.",
    );
  }

  if (
    apiKeyRecord.status === "expired" ||
    (apiKeyRecord.expiresAt ? apiKeyRecord.expiresAt <= now : false)
  ) {
    throw createForbiddenError(
      "expired_api_key",
      "The provided API key has expired.",
    );
  }

  if (!apiKeyRecord.workspace || apiKeyRecord.workspace.status !== "active") {
    throw createForbiddenError(
      "invalid_workspace",
      "The workspace associated with this API key is inactive.",
    );
  }

  await touchGatewayApiKeyLastUsedAt(apiKeyRecord.id, { now }, database);

  return {
    workspaceId: apiKeyRecord.workspaceId,
    apiKeyId: apiKeyRecord.id,
    defaultProjectId: apiKeyRecord.projectId ?? undefined,
  };
}

async function loadGatewayMeContextFromDatabase(
  database: Database,
  authContext: GatewayAuthContext,
): Promise<GatewayMeContext> {
  const workspace = await database.query.workspaces.findFirst({
    where: (workspaces, { eq }) => eq(workspaces.id, authContext.workspaceId),
  });

  if (!workspace || workspace.status !== "active") {
    throw createForbiddenError(
      "invalid_workspace",
      "The workspace associated with this API key is inactive.",
    );
  }

  const [project, providersConfigured] = await Promise.all([
    loadActiveProject(
      database,
      authContext.workspaceId,
      authContext.defaultProjectId,
    ),
    listConfiguredProviders(database, authContext.workspaceId),
  ]);

  return {
    workspace: {
      id: workspace.id,
      name: workspace.name,
    },
    project,
    availableModes: MODE_VALUES,
    availableTaskTypes: TASK_TYPE_VALUES,
    providersConfigured,
  };
}

async function resolveGatewayProjectFromDatabase(
  database: Database,
  authContext: GatewayAuthContext,
  requestedProjectId?: string,
) {
  return loadActiveProject(
    database,
    authContext.workspaceId,
    requestedProjectId ?? authContext.defaultProjectId,
  );
}

export function parseBearerToken(
  authorizationHeader: string | string[] | undefined,
) {
  const authorizationValue = getHeaderValue(authorizationHeader)?.trim();

  if (!authorizationValue) {
    throw createAuthError(
      "missing_authorization_header",
      "Missing Authorization header.",
    );
  }

  const bearerMatch = authorizationValue.match(/^Bearer\s+(.+)$/i);
  const token = bearerMatch?.[1]?.trim();

  if (!token) {
    throw createAuthError("invalid_bearer_token", "Invalid Bearer token.");
  }

  return token;
}

export function createDatabaseGatewayAuthService(): GatewayAuthService {
  return {
    async authenticateApiKey(apiKey, input) {
      return withConfiguredDatabase((database) =>
        authenticateApiKeyFromDatabase(
          database,
          apiKey,
          input?.now ?? new Date(),
        ),
      );
    },
    async loadMeContext(authContext) {
      return withConfiguredDatabase((database) =>
        loadGatewayMeContextFromDatabase(database, authContext),
      );
    },
    async resolveProject(authContext, requestedProjectId) {
      return withConfiguredDatabase((database) =>
        resolveGatewayProjectFromDatabase(
          database,
          authContext,
          requestedProjectId,
        ),
      );
    },
  };
}

export function requireGatewayAuthContext<
  T extends { gatewayAuth: GatewayAuthContext | null },
>(request: T): GatewayAuthContext {
  if (request.gatewayAuth) {
    return request.gatewayAuth;
  }

  throw createGatewayApiError({
    statusCode: 500,
    type: "internal_error",
    code: "unexpected_gateway_error",
    message: "The gateway authentication context is missing for this request.",
  });
}
