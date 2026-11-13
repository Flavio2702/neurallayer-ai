import { createHash, randomBytes, randomUUID } from "node:crypto";

import { and, asc, desc, eq, sql } from "drizzle-orm";

import type { Database } from "./client";
import { withDatabase } from "./connection-helpers";
import { auditEvents, gatewayApiKeys, projects, workspaces } from "./schema";

type DatabaseTransaction = Parameters<
  Parameters<Database["transaction"]>[0]
>[0];
type GatewayApiKeyServiceDatabase = Database | DatabaseTransaction;

const GATEWAY_API_KEY_RAW_PREFIX = "nl_";
const GATEWAY_API_KEY_PREFIX_LENGTH = 12;
const PROJECT_KEY_SCOPE = "project";

export type ProjectGatewayApiKeySummary = {
  id: string;
  projectId: string;
  name: string;
  keyPrefix: string;
  status: (typeof gatewayApiKeys.$inferSelect)["status"];
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
};

export type CreatedProjectGatewayApiKey = {
  apiKey: ProjectGatewayApiKeySummary;
  rawKey: string;
};

export type GatewayApiKeyLifecycleErrorCode =
  | "workspace_not_found"
  | "project_not_found"
  | "project_inactive"
  | "invalid_api_key_name"
  | "api_key_not_found";

export class GatewayApiKeyLifecycleError extends Error {
  readonly code: GatewayApiKeyLifecycleErrorCode;

  constructor(code: GatewayApiKeyLifecycleErrorCode, message: string) {
    super(message);
    this.name = "GatewayApiKeyLifecycleError";
    this.code = code;
  }
}

function createGatewayApiKeyLifecycleError(
  code: GatewayApiKeyLifecycleErrorCode,
) {
  switch (code) {
    case "workspace_not_found":
      return new GatewayApiKeyLifecycleError(
        code,
        "The requested workspace does not exist.",
      );
    case "project_not_found":
      return new GatewayApiKeyLifecycleError(
        code,
        "The requested project does not exist in this workspace.",
      );
    case "project_inactive":
      return new GatewayApiKeyLifecycleError(
        code,
        "The requested project is inactive.",
      );
    case "invalid_api_key_name":
      return new GatewayApiKeyLifecycleError(code, "API key name is required.");
    case "api_key_not_found":
      return new GatewayApiKeyLifecycleError(
        code,
        "The requested API key does not exist in this project.",
      );
    default:
      return new GatewayApiKeyLifecycleError(
        "api_key_not_found",
        "The requested API key does not exist in this project.",
      );
  }
}

function toOptionalIsoString(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

function sanitizeGatewayApiKeyName(name: string) {
  const normalizedName = name.trim();

  if (normalizedName.length === 0) {
    throw createGatewayApiKeyLifecycleError("invalid_api_key_name");
  }

  return normalizedName;
}

function toProjectGatewayApiKeySummary(
  row: typeof gatewayApiKeys.$inferSelect,
): ProjectGatewayApiKeySummary {
  return {
    id: row.id,
    projectId: row.projectId ?? "",
    name: row.name,
    keyPrefix: row.keyPrefix,
    status: row.status,
    lastUsedAt: toOptionalIsoString(row.lastUsedAt),
    expiresAt: toOptionalIsoString(row.expiresAt),
    createdAt: row.createdAt.toISOString(),
  };
}

async function requireWorkspaceExists(
  db: GatewayApiKeyServiceDatabase,
  workspaceId: string,
) {
  const [workspace] = await db
    .select({
      id: workspaces.id,
    })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);

  if (!workspace) {
    throw createGatewayApiKeyLifecycleError("workspace_not_found");
  }
}

async function requireProjectRow(
  db: GatewayApiKeyServiceDatabase,
  input: {
    workspaceId: string;
    projectId: string;
  },
) {
  const [project] = await db
    .select()
    .from(projects)
    .where(
      and(
        eq(projects.workspaceId, input.workspaceId),
        eq(projects.id, input.projectId),
      ),
    )
    .limit(1);

  if (!project) {
    throw createGatewayApiKeyLifecycleError("project_not_found");
  }

  return project;
}

async function requireProjectGatewayApiKeyRow(
  db: GatewayApiKeyServiceDatabase,
  input: {
    workspaceId: string;
    projectId: string;
    apiKeyId: string;
  },
) {
  const [apiKey] = await db
    .select()
    .from(gatewayApiKeys)
    .where(
      and(
        eq(gatewayApiKeys.workspaceId, input.workspaceId),
        eq(gatewayApiKeys.projectId, input.projectId),
        eq(gatewayApiKeys.id, input.apiKeyId),
      ),
    )
    .limit(1);

  if (!apiKey) {
    throw createGatewayApiKeyLifecycleError("api_key_not_found");
  }

  return apiKey;
}

async function insertGatewayApiKeyAuditEvent(
  db: GatewayApiKeyServiceDatabase,
  input: {
    workspaceId: string;
    projectId: string;
    apiKeyId: string;
    eventType: string;
    eventPayload: Record<string, unknown>;
    createdAt: Date;
  },
) {
  await db.insert(auditEvents).values({
    id: randomUUID(),
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    actorType: "system",
    eventType: input.eventType,
    entityType: "gateway_api_key",
    entityId: input.apiKeyId,
    eventPayload: input.eventPayload,
    createdAt: input.createdAt,
  });
}

export function generateRawGatewayApiKey() {
  return `${GATEWAY_API_KEY_RAW_PREFIX}${randomBytes(24).toString("base64url")}`;
}

export function hashGatewayApiKey(apiKey: string) {
  return createHash("sha256").update(apiKey).digest("hex");
}

export function getGatewayApiKeyPrefix(apiKey: string) {
  return apiKey.slice(0, GATEWAY_API_KEY_PREFIX_LENGTH);
}

export async function createProjectGatewayApiKey(
  input: {
    workspaceId: string;
    projectId: string;
    name: string;
  },
  database?: Database,
): Promise<CreatedProjectGatewayApiKey> {
  return withDatabase(database, async (db) => {
    await requireWorkspaceExists(db, input.workspaceId);

    const name = sanitizeGatewayApiKeyName(input.name);

    return db.transaction(async (tx) => {
      const project = await requireProjectRow(tx, input);

      if (project.status !== "active") {
        throw createGatewayApiKeyLifecycleError("project_inactive");
      }

      const rawKey = generateRawGatewayApiKey();
      const now = new Date();
      const [apiKey] = await tx
        .insert(gatewayApiKeys)
        .values({
          id: randomUUID(),
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          name,
          keyPrefix: getGatewayApiKeyPrefix(rawKey),
          keyHash: hashGatewayApiKey(rawKey),
          status: "active",
          expiresAt: null,
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      if (!apiKey) {
        throw createGatewayApiKeyLifecycleError("api_key_not_found");
      }

      await insertGatewayApiKeyAuditEvent(tx, {
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        apiKeyId: apiKey.id,
        eventType: "gateway_api_key.created",
        eventPayload: {
          message: `Created gateway API key ${apiKey.name}.`,
          name: apiKey.name,
          key_prefix: apiKey.keyPrefix,
          status: apiKey.status,
          scope: PROJECT_KEY_SCOPE,
        },
        createdAt: now,
      });

      return {
        apiKey: toProjectGatewayApiKeySummary(apiKey),
        rawKey,
      };
    });
  });
}

export async function listProjectGatewayApiKeys(
  input: {
    workspaceId: string;
    projectId: string;
  },
  database?: Database,
): Promise<ProjectGatewayApiKeySummary[]> {
  return withDatabase(database, async (db) => {
    await requireWorkspaceExists(db, input.workspaceId);
    await requireProjectRow(db, input);

    const rows = await db.query.gatewayApiKeys.findMany({
      where: (table, { and, eq }) =>
        and(
          eq(table.workspaceId, input.workspaceId),
          eq(table.projectId, input.projectId),
        ),
      orderBy: (table) => [
        sql<number>`case when ${table.status} = 'active' then 0 else 1 end`,
        desc(table.createdAt),
        asc(table.name),
        asc(table.id),
      ],
    });

    return rows.map(toProjectGatewayApiKeySummary);
  });
}

export async function revokeProjectGatewayApiKey(
  input: {
    workspaceId: string;
    projectId: string;
    apiKeyId: string;
  },
  database?: Database,
): Promise<ProjectGatewayApiKeySummary> {
  return withDatabase(database, async (db) => {
    await requireWorkspaceExists(db, input.workspaceId);
    await requireProjectRow(db, input);

    return db.transaction(async (tx) => {
      const apiKey = await requireProjectGatewayApiKeyRow(tx, input);

      if (apiKey.status === "revoked") {
        return toProjectGatewayApiKeySummary(apiKey);
      }

      const now = new Date();
      const [revokedApiKey] = await tx
        .update(gatewayApiKeys)
        .set({
          status: "revoked",
          updatedAt: now,
        })
        .where(eq(gatewayApiKeys.id, apiKey.id))
        .returning();

      if (!revokedApiKey) {
        throw createGatewayApiKeyLifecycleError("api_key_not_found");
      }

      await insertGatewayApiKeyAuditEvent(tx, {
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        apiKeyId: revokedApiKey.id,
        eventType: "gateway_api_key.revoked",
        eventPayload: {
          message: `Revoked gateway API key ${revokedApiKey.name}.`,
          name: revokedApiKey.name,
          key_prefix: revokedApiKey.keyPrefix,
          status: revokedApiKey.status,
          scope: PROJECT_KEY_SCOPE,
          revoked_at: now.toISOString(),
        },
        createdAt: now,
      });

      return toProjectGatewayApiKeySummary(revokedApiKey);
    });
  });
}

export async function touchGatewayApiKeyLastUsedAt(
  apiKeyId: string,
  input: {
    now?: Date;
  } = {},
  database?: Database,
) {
  return withDatabase(database, async (db) => {
    const touchedAt = input.now ?? new Date();

    await db
      .update(gatewayApiKeys)
      .set({
        lastUsedAt: touchedAt,
        updatedAt: touchedAt,
      })
      .where(eq(gatewayApiKeys.id, apiKeyId));

    return {
      apiKeyId,
      lastUsedAt: touchedAt.toISOString(),
    };
  });
}
