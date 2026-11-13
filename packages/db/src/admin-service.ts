import { randomUUID } from "node:crypto";

import { loadAdminConfig } from "@neuralayer/config";
import {
  PROVIDER_NAME_VALUES,
  type ProviderName,
  REQUEST_STATUS_VALUES,
  type RequestStatus,
} from "@neuralayer/core";
import { and, asc, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { normalizeAuditEventFields } from "./audit-event-summary";
import type { Database } from "./client";
import { withDatabase } from "./connection-helpers";
import {
  DEMO_API_KEY_ID,
  DEMO_API_KEY_RAW,
  DEMO_PROJECT_ID,
  DEMO_WORKSPACE_ID,
} from "./demo";
import {
  getStoredProviderCredentialState,
  type StoredProviderCredentialConfig,
} from "./provider-account-credentials";
import {
  clearProviderAccountOperationalOutcomeMetadata,
  type ProviderAccountOperationalOutcome,
  readProviderAccountOperationalOutcome,
  recordProviderAccountOperationalOutcome,
} from "./provider-account-posture-service";
import { encryptProviderCredentials } from "./provider-credentials-crypto";
import {
  auditEvents,
  gatewayApiKeys,
  modelCatalog,
  providerAccounts,
  requests,
  usageRecords,
} from "./schema";

const PROVIDER_CREDENTIAL_MASK_PREFIX = "****";
const PROVIDER_CREDENTIAL_MASK_SUFFIX_PATTERN = /[A-Za-z0-9._:-]/;
const PROVIDER_CREDENTIAL_MASK_PATTERN = /^\*{4}[A-Za-z0-9._:-]{0,12}$/;

export type ProviderCredentialState = "missing" | "placeholder" | "stored";
export type ProviderReadiness =
  | "needs_setup"
  | "configured"
  | "ready"
  | "attention";

export interface AdminWorkspaceContext {
  workspace: {
    id: string;
    name: string;
    slug: string;
    defaultMode: "max_quality" | "balanced" | "budget";
  };
  project: {
    id: string;
    name: string;
    slug: string;
  } | null;
}

export interface ProviderStatusSummary {
  provider: ProviderName;
  displayName: string;
  modelCoverageCount: number;
  readiness: ProviderReadiness;
  credentialState: ProviderCredentialState;
  credentialPreview: string | null;
  account: {
    id: string;
    displayName: string;
    status: "active" | "inactive" | "error";
    testStatus: string | null;
    lastTestedAt: string | null;
    credentialUpdatedAt: string | null;
    updatedAt: string;
  } | null;
  lastConnectionTest: {
    testedAt: string;
    requestStatus: RequestStatus;
    modelId: string | null;
    errorCode: string | null;
    errorMessage: string | null;
  } | null;
  lastOutcome: ProviderAccountOperationalOutcome | null;
  latestAttempt: {
    requestId: string;
    status:
      | "pending"
      | "running"
      | "succeeded"
      | "failed"
      | "timeout"
      | "blocked";
    modelId: string;
    providerRequestId: string | null;
    latencyMs: number | null;
    errorType: string | null;
    errorCode: string | null;
    errorMessage: string | null;
    startedAt: string;
    completedAt: string | null;
  } | null;
}

export interface GatewayApiKeySummary {
  id: string;
  name: string;
  keyPrefix: string;
  status: "active" | "revoked" | "expired";
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  project: {
    id: string;
    name: string;
  } | null;
  isSeededDemoKey: boolean;
  rawKey: string | null;
}

export interface RequestEnvelopeSummary {
  stream: boolean;
  messageCount: number;
  messageRoles: string[];
  metadataKeys: string[];
  promptRedacted: boolean;
}

export interface RecentRequestSummary {
  id: string;
  project: {
    id: string;
    name: string;
  };
  apiKey: {
    id: string;
    name: string;
    keyPrefix: string;
  };
  mode: "max_quality" | "balanced" | "budget";
  taskType: string;
  status: "pending" | "running" | "succeeded" | "failed" | "blocked";
  startedAt: string;
  completedAt: string | null;
  requestEnvelope: RequestEnvelopeSummary;
  routing: {
    selectionReasonCode: string | null;
    selectionReasonText: string | null;
    selectedProvider: string | null;
    selectedModel: string | null;
  };
  latestAttempt: {
    status: string;
    provider: string;
    modelId: string;
    latencyMs: number | null;
    errorType: string | null;
    errorCode: string | null;
    errorMessage: string | null;
    completedAt: string | null;
  } | null;
  usage: {
    usageSource: string;
    inputTokens: number | null;
    outputTokens: number | null;
    totalTokens: number | null;
    costTotalUsd: number | null;
    pricingVersion: string | null;
  } | null;
  outcome: {
    eventType: string | null;
    message: string | null;
    requestStatus: string | null;
    errorType: string | null;
    errorCode: string | null;
    costTotalUsd: number | null;
  };
}

export interface RecentAuditEventSummary {
  id: string;
  createdAt: string;
  eventType: string;
  entityType: string;
  entityId: string;
  actorType: string;
  project: {
    id: string;
    name: string;
  } | null;
  actorApiKey: {
    id: string;
    name: string;
    keyPrefix: string;
  } | null;
  message: string | null;
  provider: string | null;
  model: string | null;
  requestStatus: string | null;
  errorType: string | null;
  errorCode: string | null;
  costTotalUsd: number | null;
}

export interface WorkspaceOverviewStats {
  workspaceId: string;
  start: string;
  end: string;
  requestCount: number;
  blockedCount: number;
  failedCount: number;
  succeededCount: number;
  usageRecordCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalCostUsd: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRequestStatus(value: unknown): value is RequestStatus {
  return REQUEST_STATUS_VALUES.includes(value as RequestStatus);
}

function toOptionalString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function toOptionalNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : null;
}

function toDateISOString(value: Date | string | null | undefined) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  const parsed = new Date(value);

  return Number.isNaN(parsed.valueOf()) ? null : parsed.toISOString();
}

function mergeMetadata(
  existingMetadata: Record<string, unknown> | null | undefined,
  patch: Record<string, unknown>,
) {
  return {
    ...(existingMetadata ?? {}),
    ...patch,
  };
}

function buildDefaultProviderDisplayName(provider: ProviderName) {
  switch (provider) {
    case "openai":
      return "OpenAI Workspace Account";
    case "anthropic":
      return "Anthropic Workspace Account";
    default:
      return `${provider} Workspace Account`;
  }
}

function buildProviderKeyLabel(provider: ProviderName) {
  switch (provider) {
    case "openai":
      return "OPENAI_API_KEY";
    case "anthropic":
      return "ANTHROPIC_API_KEY";
    default:
      return "PROVIDER_API_KEY";
  }
}

function readAdminWorkspaceTargeting() {
  const {
    admin: { workspaceId, smokeWorkspaceId },
  } = loadAdminConfig();

  return {
    workspaceId: workspaceId ?? null,
    smokeWorkspaceId: smokeWorkspaceId ?? null,
  };
}

function sanitizeProviderCredentialMaskSuffix(value: string) {
  return Array.from(value)
    .map((character) =>
      PROVIDER_CREDENTIAL_MASK_SUFFIX_PATTERN.test(character) ? character : "_",
    )
    .join("");
}

export function maskProviderApiKey(apiKey: string) {
  const trimmedValue = apiKey.trim();

  if (trimmedValue.length <= 4) {
    return PROVIDER_CREDENTIAL_MASK_PREFIX;
  }

  return `${PROVIDER_CREDENTIAL_MASK_PREFIX}${sanitizeProviderCredentialMaskSuffix(trimmedValue.slice(-4))}`;
}

export function readMaskedProviderCredentialPreview(
  metadata: unknown,
): string | null {
  if (!isRecord(metadata)) {
    return null;
  }

  const credentialMask = toOptionalString(metadata.credentialMask);

  if (
    !credentialMask ||
    !PROVIDER_CREDENTIAL_MASK_PATTERN.test(credentialMask)
  ) {
    return null;
  }

  return credentialMask;
}

export function getProviderCredentialState(
  encryptedCredentials: string | null | undefined,
): ProviderCredentialState {
  return getStoredProviderCredentialState(encryptedCredentials);
}

function extractLastConnectionTestSummary(
  auditEvent:
    | {
        createdAt: Date;
        eventPayload: Record<string, unknown>;
      }
    | null
    | undefined,
  credentialUpdatedAt: string | null,
) {
  if (!auditEvent) {
    return null;
  }

  const testedAt = auditEvent.createdAt.toISOString();

  if (credentialUpdatedAt) {
    const testedAtTimestamp = new Date(testedAt).valueOf();
    const credentialUpdatedTimestamp = new Date(credentialUpdatedAt).valueOf();

    if (
      !Number.isNaN(testedAtTimestamp) &&
      !Number.isNaN(credentialUpdatedTimestamp) &&
      testedAtTimestamp < credentialUpdatedTimestamp
    ) {
      return null;
    }
  }

  const payload = auditEvent.eventPayload;
  const metadata = isRecord(payload.metadata) ? payload.metadata : undefined;
  const requestStatus = isRequestStatus(metadata?.request_status)
    ? metadata.request_status
    : null;

  if (!requestStatus) {
    return null;
  }

  return {
    testedAt,
    requestStatus,
    modelId: toOptionalString(payload.model),
    errorCode: toOptionalString(metadata?.error_code),
    errorMessage: toOptionalString(metadata?.error_message),
  };
}

function summarizeRequestEnvelope(
  value: Record<string, unknown> | null | undefined,
): RequestEnvelopeSummary {
  const stream =
    typeof value?.stream === "boolean"
      ? value.stream
      : typeof value?.normalized_stream === "boolean"
        ? value.normalized_stream
        : false;
  const messages = Array.isArray(value?.messages) ? value.messages : [];
  const messageCount =
    typeof value?.message_count === "number"
      ? value.message_count
      : messages.length;
  const messageRoles =
    Array.isArray(value?.message_roles) && value.message_roles.length > 0
      ? value.message_roles
          .filter((entry): entry is string => typeof entry === "string")
          .slice(0, 10)
      : messages
          .map((message) =>
            isRecord(message) && typeof message.role === "string"
              ? message.role
              : null,
          )
          .filter((entry): entry is string => entry !== null)
          .slice(0, 10);
  const metadataKeys =
    Array.isArray(value?.metadata_keys) && value.metadata_keys.length > 0
      ? value.metadata_keys
          .filter((entry): entry is string => typeof entry === "string")
          .sort()
      : isRecord(value?.metadata)
        ? Object.keys(value.metadata).sort()
        : [];

  return {
    stream,
    messageCount,
    messageRoles,
    metadataKeys,
    promptRedacted: true,
  };
}

function extractRoutingSummary(
  events: Array<{ eventType: string; eventPayload: Record<string, unknown> }>,
) {
  const routingEvent = events.find(
    (event) => event.eventType === "chat.routing.decision",
  );
  const payload = routingEvent?.eventPayload;
  const routingDecision = isRecord(payload?.routing_decision)
    ? payload.routing_decision
    : undefined;
  const selected = isRecord(routingDecision?.selected)
    ? routingDecision.selected
    : undefined;

  return {
    selectionReasonCode:
      toOptionalString(routingDecision?.selectionReasonCode) ??
      toOptionalString(payload?.selection_reason_code),
    selectionReasonText:
      toOptionalString(routingDecision?.selectionReasonText) ??
      toOptionalString(payload?.selection_reason_text) ??
      toOptionalString(payload?.message),
    selectedProvider:
      toOptionalString(selected?.provider) ??
      toOptionalString(payload?.provider),
    selectedModel:
      toOptionalString(selected?.model) ?? toOptionalString(payload?.model),
  };
}

function extractOutcomeSummary(
  events: Array<{ eventType: string; eventPayload: Record<string, unknown> }>,
) {
  const outcomeEvent = events.find((event) =>
    event.eventType.startsWith("chat.completions."),
  );
  const payload = outcomeEvent?.eventPayload;
  const metadata = isRecord(payload?.metadata) ? payload.metadata : undefined;

  return {
    eventType: outcomeEvent?.eventType ?? null,
    message: toOptionalString(payload?.message),
    requestStatus: toOptionalString(metadata?.request_status),
    errorType: toOptionalString(metadata?.error_type),
    errorCode: toOptionalString(metadata?.error_code),
    costTotalUsd: toOptionalNumber(metadata?.cost_total_usd),
  };
}

function resolveProviderReadiness(input: {
  credentialState: ProviderCredentialState;
  credentialUpdatedAt: string | null;
  lastTestedAt: string | null;
  testStatus: string | null;
}): ProviderReadiness {
  if (input.credentialState !== "stored") {
    return "needs_setup";
  }

  if (!input.lastTestedAt || !input.testStatus) {
    return "configured";
  }

  const credentialUpdatedAt = input.credentialUpdatedAt;

  if (credentialUpdatedAt) {
    const lastTestedTimestamp = new Date(input.lastTestedAt).valueOf();
    const credentialUpdatedTimestamp = new Date(credentialUpdatedAt).valueOf();

    if (
      !Number.isNaN(lastTestedTimestamp) &&
      !Number.isNaN(credentialUpdatedTimestamp) &&
      lastTestedTimestamp < credentialUpdatedTimestamp
    ) {
      return "configured";
    }
  }

  return input.testStatus === "ready" ? "ready" : "attention";
}

async function resolveWorkspaceProject(db: Database, workspaceId: string) {
  const activeProjects = (
    await db.query.projects.findMany({
      where: (table, { and, eq }) =>
        and(eq(table.workspaceId, workspaceId), eq(table.status, "active")),
      orderBy: (table, { asc }) => [asc(table.name), asc(table.id)],
    })
  )
    .filter(
      (project) =>
        project.workspaceId === workspaceId && project.status === "active",
    )
    .sort(
      (left, right) =>
        left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
    );

  if (workspaceId === DEMO_WORKSPACE_ID) {
    const demoProject =
      activeProjects.find((project) => project.id === DEMO_PROJECT_ID) ?? null;

    if (demoProject) {
      return {
        id: demoProject.id,
        name: demoProject.name,
        slug: demoProject.slug,
      };
    }
  }

  const project = activeProjects[0] ?? null;

  return project
    ? {
        id: project.id,
        name: project.name,
        slug: project.slug,
      }
    : null;
}

async function listActiveAdminWorkspaces(db: Database) {
  return (
    await db.query.workspaces.findMany({
      where: (table, { eq }) => eq(table.status, "active"),
      orderBy: (table, { asc }) => [asc(table.name), asc(table.id)],
    })
  )
    .filter((workspace) => workspace.status === "active")
    .sort(
      (left, right) =>
        left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
    );
}

function pickFallbackAdminWorkspace(
  workspaces: Awaited<ReturnType<typeof listActiveAdminWorkspaces>>,
) {
  if (workspaces.length === 0) {
    return null;
  }

  const nonDemoWorkspaces = workspaces.filter(
    (workspace) => workspace.id !== DEMO_WORKSPACE_ID,
  );

  if (nonDemoWorkspaces.length === 1) {
    return nonDemoWorkspaces[0];
  }

  if (workspaces.length === 1) {
    return workspaces[0];
  }

  throw new Error(
    `Multiple active workspaces are available for admin targeting (${workspaces.map((workspace) => workspace.id).join(", ")}). Configure ADMIN_WORKSPACE_ID to target the pilot workspace explicitly.`,
  );
}

async function buildAdminWorkspaceContext(
  db: Database,
  workspace: Awaited<ReturnType<typeof listActiveAdminWorkspaces>>[number],
): Promise<AdminWorkspaceContext> {
  return {
    workspace: {
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
      defaultMode: workspace.defaultMode,
    },
    project: await resolveWorkspaceProject(db, workspace.id),
  };
}

export async function resolveDefaultAdminWorkspace(
  database?: Database,
): Promise<AdminWorkspaceContext | null> {
  return withDatabase(database, async (db) => {
    const { workspaceId, smokeWorkspaceId } = readAdminWorkspaceTargeting();
    const activeWorkspaces = await listActiveAdminWorkspaces(db);
    const overriddenWorkspaceId = smokeWorkspaceId ?? workspaceId;
    const overriddenEnvName = smokeWorkspaceId
      ? "ADMIN_SMOKE_WORKSPACE_ID"
      : workspaceId
        ? "ADMIN_WORKSPACE_ID"
        : null;

    if (overriddenWorkspaceId && overriddenEnvName) {
      const overriddenWorkspace =
        activeWorkspaces.find(
          (workspace) => workspace.id === overriddenWorkspaceId,
        ) ?? null;

      if (!overriddenWorkspace) {
        throw new Error(
          `Configured ${overriddenEnvName} ${overriddenWorkspaceId} did not resolve to an active workspace.`,
        );
      }

      return buildAdminWorkspaceContext(db, overriddenWorkspace);
    }

    const workspace = pickFallbackAdminWorkspace(activeWorkspaces);

    if (!workspace) {
      return null;
    }

    return buildAdminWorkspaceContext(db, workspace);
  });
}

export async function listProviderStatusSummaries(
  workspaceId: string,
  database?: Database,
): Promise<ProviderStatusSummary[]> {
  return withDatabase(database, async (db) => {
    const providerAccountRows = await db.query.providerAccounts.findMany({
      where: (table, { eq }) => eq(table.workspaceId, workspaceId),
      orderBy: (table, { desc, asc }) => [
        asc(table.provider),
        desc(table.updatedAt),
        asc(table.displayName),
        asc(table.id),
      ],
    });
    const modelCoverageRows = await db
      .select({
        provider: modelCatalog.provider,
        count: sql<string>`count(*)::text`,
      })
      .from(modelCatalog)
      .where(
        and(
          eq(modelCatalog.status, "active"),
          eq(modelCatalog.isActive, true),
          eq(modelCatalog.supportsChat, true),
        ),
      )
      .groupBy(modelCatalog.provider);
    const selectedAccounts = new Map<
      ProviderName,
      (typeof providerAccountRows)[number]
    >();

    for (const provider of PROVIDER_NAME_VALUES) {
      const matchingAccount = providerAccountRows.find(
        (account) => account.provider === provider,
      );

      if (matchingAccount) {
        selectedAccounts.set(provider, matchingAccount);
      }
    }

    const modelCoverageLookup = new Map<ProviderName, number>();

    for (const row of modelCoverageRows) {
      modelCoverageLookup.set(row.provider, Number(row.count));
    }

    return Promise.all(
      PROVIDER_NAME_VALUES.map(async (provider) => {
        const account = selectedAccounts.get(provider) ?? null;
        const accountMetadata = isRecord(account?.metadata)
          ? account.metadata
          : undefined;
        const credentialUpdatedAt =
          toOptionalString(accountMetadata?.credentialUpdatedAt) ??
          toDateISOString(account?.createdAt) ??
          null;
        const latestAttempt = await db.query.requestAttempts.findFirst({
          where: (table, { and, eq }) =>
            and(
              eq(table.workspaceId, workspaceId),
              eq(table.provider, provider),
            ),
          orderBy: (table, { desc }) => [
            desc(table.completedAt),
            desc(table.startedAt),
            desc(table.attemptNumber),
          ],
        });
        const latestConnectionTestEvent = account
          ? await db.query.auditEvents.findFirst({
              where: (table, { and, eq }) =>
                and(
                  eq(table.workspaceId, workspaceId),
                  eq(table.eventType, "provider_account.connection_tested"),
                  eq(table.entityType, "provider_account"),
                  eq(table.entityId, account.id),
                ),
              orderBy: (table, { desc }) => [
                desc(table.createdAt),
                desc(table.id),
              ],
            })
          : null;
        const credentialState = getProviderCredentialState(
          account?.encryptedCredentials,
        );
        const lastOutcome = readProviderAccountOperationalOutcome(
          accountMetadata,
          provider,
        );
        const lastTestedAt = toDateISOString(account?.lastTestedAt);
        const lastConnectionTest = extractLastConnectionTestSummary(
          latestConnectionTestEvent
            ? {
                createdAt: latestConnectionTestEvent.createdAt,
                eventPayload: latestConnectionTestEvent.eventPayload,
              }
            : null,
          credentialUpdatedAt,
        );

        return {
          provider,
          displayName:
            account?.displayName ?? buildDefaultProviderDisplayName(provider),
          modelCoverageCount: modelCoverageLookup.get(provider) ?? 0,
          readiness: resolveProviderReadiness({
            credentialState,
            credentialUpdatedAt,
            lastTestedAt,
            testStatus: account?.testStatus ?? null,
          }),
          credentialState,
          credentialPreview:
            readMaskedProviderCredentialPreview(accountMetadata),
          account: account
            ? {
                id: account.id,
                displayName: account.displayName,
                status: account.status,
                testStatus: account.testStatus,
                lastTestedAt,
                credentialUpdatedAt,
                updatedAt: account.updatedAt.toISOString(),
              }
            : null,
          lastConnectionTest,
          lastOutcome,
          latestAttempt: latestAttempt
            ? {
                requestId: latestAttempt.requestId,
                status: latestAttempt.status,
                modelId: latestAttempt.modelId,
                providerRequestId: latestAttempt.providerRequestId,
                latencyMs: latestAttempt.latencyMs,
                errorType: latestAttempt.errorType,
                errorCode: latestAttempt.errorCode,
                errorMessage: latestAttempt.errorMessage,
                startedAt: latestAttempt.startedAt.toISOString(),
                completedAt: toDateISOString(latestAttempt.completedAt),
              }
            : null,
        } satisfies ProviderStatusSummary;
      }),
    );
  });
}

export async function upsertProviderCredentials(
  input: {
    workspaceId: string;
    provider: ProviderName;
    apiKey: string;
  },
  database?: Database,
) {
  return withDatabase(database, async (db) => {
    const apiKey = input.apiKey.trim();

    if (apiKey.length === 0) {
      throw new Error("Provider apiKey is required.");
    }

    const now = new Date();
    const existingAccount = await db.query.providerAccounts.findFirst({
      where: (table, { and, eq }) =>
        and(
          eq(table.workspaceId, input.workspaceId),
          eq(table.provider, input.provider),
        ),
      orderBy: (table, { desc, asc }) => [
        desc(table.updatedAt),
        asc(table.displayName),
        asc(table.id),
      ],
    });
    const storedCredentials = encryptProviderCredentials({
      apiKey,
    } satisfies StoredProviderCredentialConfig);
    const credentialMask = maskProviderApiKey(apiKey);
    const displayName =
      existingAccount?.displayName ??
      buildDefaultProviderDisplayName(input.provider);
    const metadata = mergeMetadata(
      clearProviderAccountOperationalOutcomeMetadata(existingAccount?.metadata),
      {
        credentialUpdatedAt: now.toISOString(),
        credentialMask,
        providerKeyLabel: buildProviderKeyLabel(input.provider),
        updatedVia: "admin_surface",
      },
    );
    const accountId = existingAccount?.id ?? randomUUID();

    if (existingAccount) {
      await db
        .update(providerAccounts)
        .set({
          displayName,
          status: "active",
          encryptedCredentials: storedCredentials,
          testStatus: "configured",
          lastTestedAt: null,
          metadata,
          updatedAt: now,
        })
        .where(eq(providerAccounts.id, accountId));
    } else {
      await db.insert(providerAccounts).values({
        id: accountId,
        workspaceId: input.workspaceId,
        provider: input.provider,
        displayName,
        status: "active",
        encryptedCredentials: storedCredentials,
        testStatus: "configured",
        lastTestedAt: null,
        metadata,
        createdAt: now,
        updatedAt: now,
      });
    }

    await db.insert(auditEvents).values({
      id: randomUUID(),
      workspaceId: input.workspaceId,
      actorType: "system",
      eventType: "provider_account.credentials_updated",
      entityType: "provider_account",
      entityId: accountId,
      eventPayload: {
        message: `Updated ${input.provider} provider credentials from admin.`,
        provider: input.provider,
        credential_mask: credentialMask,
      },
      createdAt: now,
    });

    return {
      providerAccountId: accountId,
      credentialMask,
    };
  });
}

export async function updateProviderAccountRuntimePosture(
  input: {
    providerAccountId?: string;
    workspaceId?: string;
    provider?: ProviderName;
    requestStatus: "pending" | "running" | "succeeded" | "failed" | "blocked";
    errorType?: string;
    errorCode?: string;
    errorMessage?: string;
    modelId?: string;
    latencyMs?: number | null;
    responseId?: string;
    testedAt?: Date | string;
  },
  database?: Database,
) {
  return recordProviderAccountOperationalOutcome(
    {
      ...input,
      source: "runtime",
    },
    database,
  );
}

export async function listActiveGatewayApiKeySummaries(
  workspaceId: string,
  database?: Database,
): Promise<GatewayApiKeySummary[]> {
  return withDatabase(database, async (db) => {
    const rows = await db.query.gatewayApiKeys.findMany({
      where: (table, { and, eq }) =>
        and(eq(table.workspaceId, workspaceId), eq(table.status, "active")),
      with: {
        project: true,
      },
      orderBy: (table, { desc, asc }) => [
        desc(table.createdAt),
        asc(table.name),
        asc(table.id),
      ],
    });

    return rows
      .map((row) => ({
        id: row.id,
        name: row.name,
        keyPrefix: row.keyPrefix,
        status: row.status,
        lastUsedAt: toDateISOString(row.lastUsedAt),
        expiresAt: toDateISOString(row.expiresAt),
        createdAt: row.createdAt.toISOString(),
        project: row.project
          ? {
              id: row.project.id,
              name: row.project.name,
            }
          : null,
        isSeededDemoKey: row.id === DEMO_API_KEY_ID,
        rawKey: row.id === DEMO_API_KEY_ID ? DEMO_API_KEY_RAW : null,
      }))
      .sort((left, right) => {
        if (left.isSeededDemoKey !== right.isSeededDemoKey) {
          return left.isSeededDemoKey ? -1 : 1;
        }

        return right.createdAt.localeCompare(left.createdAt);
      });
  });
}

export async function getWorkspaceOverviewStats(
  input: {
    workspaceId: string;
    start: Date;
    end: Date;
  },
  database?: Database,
): Promise<WorkspaceOverviewStats> {
  return withDatabase(database, async (db) => {
    const [requestCounts, usageSummary] = await Promise.all([
      db
        .select({
          requestCount: sql<string>`count(*)::text`,
          blockedCount: sql<string>`coalesce(sum(case when ${requests.status} = 'blocked' then 1 else 0 end), 0)::text`,
          failedCount: sql<string>`coalesce(sum(case when ${requests.status} = 'failed' then 1 else 0 end), 0)::text`,
          succeededCount: sql<string>`coalesce(sum(case when ${requests.status} = 'succeeded' then 1 else 0 end), 0)::text`,
        })
        .from(requests)
        .where(
          and(
            eq(requests.workspaceId, input.workspaceId),
            gte(requests.startedAt, input.start),
            lt(requests.startedAt, input.end),
          ),
        ),
      db
        .select({
          usageRecordCount: sql<string>`count(*)::text`,
          totalInputTokens: sql<string>`coalesce(sum(${usageRecords.inputTokens}), 0)::text`,
          totalOutputTokens: sql<string>`coalesce(sum(${usageRecords.outputTokens}), 0)::text`,
          totalTokens: sql<string>`coalesce(sum(${usageRecords.totalTokens}), 0)::text`,
          totalCostUsd: sql<string>`coalesce(sum(${usageRecords.costTotal}), 0)::text`,
        })
        .from(usageRecords)
        .where(
          and(
            eq(usageRecords.workspaceId, input.workspaceId),
            gte(usageRecords.recordedAt, input.start),
            lt(usageRecords.recordedAt, input.end),
          ),
        ),
    ]);

    return {
      workspaceId: input.workspaceId,
      start: input.start.toISOString(),
      end: input.end.toISOString(),
      requestCount: Number(requestCounts[0]?.requestCount ?? 0),
      blockedCount: Number(requestCounts[0]?.blockedCount ?? 0),
      failedCount: Number(requestCounts[0]?.failedCount ?? 0),
      succeededCount: Number(requestCounts[0]?.succeededCount ?? 0),
      usageRecordCount: Number(usageSummary[0]?.usageRecordCount ?? 0),
      totalInputTokens: Number(usageSummary[0]?.totalInputTokens ?? 0),
      totalOutputTokens: Number(usageSummary[0]?.totalOutputTokens ?? 0),
      totalTokens: Number(usageSummary[0]?.totalTokens ?? 0),
      totalCostUsd: Number(usageSummary[0]?.totalCostUsd ?? 0),
    };
  });
}

export async function listRecentWorkspaceRequests(
  input: {
    workspaceId: string;
    limit?: number;
  },
  database?: Database,
): Promise<RecentRequestSummary[]> {
  return withDatabase(database, async (db) => {
    const requestRows = await db.query.requests.findMany({
      where: (table, { eq }) => eq(table.workspaceId, input.workspaceId),
      with: {
        project: true,
        apiKey: true,
      },
      orderBy: (table, { desc }) => [desc(table.startedAt), desc(table.id)],
      limit: input.limit ?? 8,
    });

    if (requestRows.length === 0) {
      return [];
    }

    const requestIds = requestRows.map((row) => row.id);
    const [attemptRows, usageRows, auditRows] = await Promise.all([
      db.query.requestAttempts.findMany({
        where: (table, { inArray }) => inArray(table.requestId, requestIds),
        orderBy: (table, { desc }) => [
          desc(table.completedAt),
          desc(table.startedAt),
          desc(table.attemptNumber),
        ],
      }),
      db.query.usageRecords.findMany({
        where: (table, { inArray }) => inArray(table.requestId, requestIds),
        orderBy: (table, { desc }) => [desc(table.recordedAt), desc(table.id)],
      }),
      db.query.auditEvents.findMany({
        where: (table, { and, eq, inArray }) =>
          and(
            eq(table.workspaceId, input.workspaceId),
            eq(table.entityType, "request"),
            inArray(table.entityId, requestIds),
          ),
        orderBy: (table, { desc }) => [desc(table.createdAt), desc(table.id)],
      }),
    ]);
    const attemptsByRequestId = new Map<string, (typeof attemptRows)[number]>();
    const usageByRequestId = new Map<string, (typeof usageRows)[number]>();
    const auditsByRequestId = new Map<
      string,
      Array<{ eventType: string; eventPayload: Record<string, unknown> }>
    >();

    for (const attempt of attemptRows) {
      if (!attemptsByRequestId.has(attempt.requestId)) {
        attemptsByRequestId.set(attempt.requestId, attempt);
      }
    }

    for (const usage of usageRows) {
      if (!usageByRequestId.has(usage.requestId)) {
        usageByRequestId.set(usage.requestId, usage);
      }
    }

    for (const auditEvent of auditRows) {
      if (!isRecord(auditEvent.eventPayload)) {
        continue;
      }

      const currentEvents = auditsByRequestId.get(auditEvent.entityId) ?? [];

      currentEvents.push({
        eventType: auditEvent.eventType,
        eventPayload: auditEvent.eventPayload,
      });
      auditsByRequestId.set(auditEvent.entityId, currentEvents);
    }

    return requestRows.map((requestRow) => {
      const latestAttempt = attemptsByRequestId.get(requestRow.id) ?? null;
      const usage = usageByRequestId.get(requestRow.id) ?? null;
      const auditEventsForRequest = auditsByRequestId.get(requestRow.id) ?? [];
      const routing = extractRoutingSummary(auditEventsForRequest);
      const outcome = extractOutcomeSummary(auditEventsForRequest);
      const project = requestRow.project
        ? {
            id: requestRow.project.id,
            name: requestRow.project.name,
          }
        : {
            id: requestRow.projectId,
            name: "Unknown project",
          };
      const apiKey = requestRow.apiKey
        ? {
            id: requestRow.apiKey.id,
            name: requestRow.apiKey.name,
            keyPrefix: requestRow.apiKey.keyPrefix,
          }
        : {
            id: requestRow.apiKeyId,
            name: "Unknown API key",
            keyPrefix: "",
          };

      return {
        id: requestRow.id,
        project,
        apiKey,
        mode: requestRow.mode,
        taskType: requestRow.taskType,
        status: requestRow.status,
        startedAt: requestRow.startedAt.toISOString(),
        completedAt: toDateISOString(requestRow.completedAt),
        requestEnvelope: summarizeRequestEnvelope(
          isRecord(requestRow.normalizedRequestJson)
            ? requestRow.normalizedRequestJson
            : undefined,
        ),
        routing,
        latestAttempt: latestAttempt
          ? {
              status: latestAttempt.status,
              provider: latestAttempt.provider,
              modelId: latestAttempt.modelId,
              latencyMs: latestAttempt.latencyMs,
              errorType: latestAttempt.errorType,
              errorCode: latestAttempt.errorCode,
              errorMessage: latestAttempt.errorMessage,
              completedAt: toDateISOString(latestAttempt.completedAt),
            }
          : null,
        usage: usage
          ? {
              usageSource: usage.usageSource,
              inputTokens: usage.inputTokens,
              outputTokens: usage.outputTokens,
              totalTokens: usage.totalTokens,
              costTotalUsd: toOptionalNumber(usage.costTotal),
              pricingVersion: usage.pricingVersion,
            }
          : null,
        outcome,
      } satisfies RecentRequestSummary;
    });
  });
}

export async function listRecentWorkspaceAuditEvents(
  input: {
    workspaceId: string;
    limit?: number;
  },
  database?: Database,
): Promise<RecentAuditEventSummary[]> {
  return withDatabase(database, async (db) => {
    const rows = await db.query.auditEvents.findMany({
      where: (table, { eq }) => eq(table.workspaceId, input.workspaceId),
      with: {
        project: true,
        actorApiKey: true,
      },
      orderBy: (table, { desc }) => [desc(table.createdAt), desc(table.id)],
      limit: input.limit ?? 12,
    });

    return rows.map((row) => {
      const summary = normalizeAuditEventFields({
        eventType: row.eventType,
        eventPayload: row.eventPayload,
      });

      return {
        id: row.id,
        createdAt: row.createdAt.toISOString(),
        eventType: row.eventType,
        entityType: row.entityType,
        entityId: row.entityId,
        actorType: row.actorType,
        project: row.project
          ? {
              id: row.project.id,
              name: row.project.name,
            }
          : null,
        actorApiKey: row.actorApiKey
          ? {
              id: row.actorApiKey.id,
              name: row.actorApiKey.name,
              keyPrefix: row.actorApiKey.keyPrefix,
            }
          : null,
        message: summary.message,
        provider: summary.provider,
        model: summary.model,
        requestStatus: summary.requestStatus,
        errorType: summary.errorType,
        errorCode: summary.errorCode,
        costTotalUsd: summary.costTotalUsd,
      } satisfies RecentAuditEventSummary;
    });
  });
}
