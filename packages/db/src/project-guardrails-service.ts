import { randomUUID } from "node:crypto";

import { PROVIDER_NAME_VALUES, type ProviderName } from "@neuralayer/core";
import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";

import type { Database } from "./client";
import { withDatabase } from "./connection-helpers";
import { auditEvents, policyRules, projects, workspaces } from "./schema";
import {
  getWorkspaceBudgetCap,
  type WorkspaceBudgetCapSummary,
} from "./workspace-budget-cap-service";

type DatabaseTransaction = Parameters<
  Parameters<Database["transaction"]>[0]
>[0];
type ProjectGuardrailsServiceDatabase = Database | DatabaseTransaction;

const PROJECT_PREFERRED_PROVIDER_RULE_NAME = "Project preferred provider";
const PROJECT_ALLOWED_PROVIDERS_RULE_NAME = "Project allowed providers";
const MANAGED_RULE_VERSION = 1;
const VALID_PROVIDER_NAMES = new Set<string>(PROVIDER_NAME_VALUES);

type ProjectPolicyRuleRow = Awaited<
  ReturnType<typeof selectProjectPolicyRules>
>[number];

type ActiveScopedPolicyRuleRow = Awaited<
  ReturnType<typeof selectActiveScopedPolicyRules>
>[number];

type PreferredProviderSummary = {
  workspaceId: string;
  projectId: string;
  policyRuleId: string | null;
  provider: ProviderName | null;
  enabled: boolean;
  updatedAt: string | null;
};

type AllowedProvidersSummary = {
  workspaceId: string;
  projectId: string;
  policyRuleId: string | null;
  providers: ProviderName[];
  enabled: boolean;
  updatedAt: string | null;
};

type UnmanagedPolicyWarningSummary = {
  count: number;
  ruleTypes: string[];
};

export type ProjectGuardrailsForAdmin = {
  workspaceId: string;
  projectId: string;
  workspaceBudgetCap: WorkspaceBudgetCapSummary;
  preferredProvider: PreferredProviderSummary;
  allowedProviders: AllowedProvidersSummary;
  unmanagedPolicyWarnings: {
    workspace: UnmanagedPolicyWarningSummary;
    project: UnmanagedPolicyWarningSummary;
  };
};

export type ProjectGuardrailsServiceErrorCode =
  | "workspace_not_found"
  | "project_not_found"
  | "invalid_preferred_provider"
  | "invalid_allowed_provider";

export class ProjectGuardrailsServiceError extends Error {
  readonly code: ProjectGuardrailsServiceErrorCode;

  constructor(code: ProjectGuardrailsServiceErrorCode, message: string) {
    super(message);
    this.name = "ProjectGuardrailsServiceError";
    this.code = code;
  }
}

function createProjectGuardrailsServiceError(
  code: ProjectGuardrailsServiceErrorCode,
) {
  switch (code) {
    case "workspace_not_found":
      return new ProjectGuardrailsServiceError(
        code,
        "The requested workspace does not exist.",
      );
    case "project_not_found":
      return new ProjectGuardrailsServiceError(
        code,
        "The requested project does not exist in this workspace.",
      );
    case "invalid_preferred_provider":
      return new ProjectGuardrailsServiceError(
        code,
        "Preferred provider must be one of the supported provider names or null.",
      );
    case "invalid_allowed_provider":
      return new ProjectGuardrailsServiceError(
        code,
        "Allowed providers must contain only supported provider names.",
      );
    default:
      return new ProjectGuardrailsServiceError(
        "project_not_found",
        "The requested project does not exist in this workspace.",
      );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toIsoString(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

function toProviderName(value: unknown) {
  if (typeof value !== "string" || !VALID_PROVIDER_NAMES.has(value)) {
    return undefined;
  }

  return value as ProviderName;
}

function toProviderNameArray(value: unknown) {
  if (typeof value === "string") {
    const provider = toProviderName(value);

    return provider ? [provider] : [];
  }

  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => toProviderName(entry))
    .filter((entry): entry is ProviderName => typeof entry !== "undefined");
}

function sortProviderNames(providers: ProviderName[]) {
  const providerOrder = new Map(
    PROVIDER_NAME_VALUES.map((provider, index) => [provider, index]),
  );

  return [...providers].sort((left, right) => {
    const leftOrder = providerOrder.get(left) ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = providerOrder.get(right) ?? Number.MAX_SAFE_INTEGER;

    return leftOrder - rightOrder;
  });
}

function parseBudgetCapLimit(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return value;
  }

  if (typeof value !== "string" || value.trim().length === 0) {
    return undefined;
  }

  const parsedValue = Number(value);

  return Number.isFinite(parsedValue) && parsedValue >= 0
    ? parsedValue
    : undefined;
}

function parsePreferredProvider(
  conditionsJson: Record<string, unknown>,
): ProviderName | null {
  return toProviderName(conditionsJson.provider) ?? null;
}

function parseAllowedProviders(
  conditionsJson: Record<string, unknown>,
): ProviderName[] {
  return sortProviderNames([
    ...new Set(
      toProviderNameArray(conditionsJson.providers).concat(
        toProviderNameArray(conditionsJson.provider),
      ),
    ),
  ]);
}

function normalizePreferredProviderInput(provider: ProviderName | null) {
  if (provider === null) {
    return null;
  }

  const normalizedProvider = toProviderName(provider);

  if (!normalizedProvider) {
    throw createProjectGuardrailsServiceError("invalid_preferred_provider");
  }

  return normalizedProvider;
}

function normalizeAllowedProvidersInput(providers: ProviderName[]) {
  const normalizedProviders = providers.map((provider) => {
    const normalizedProvider = toProviderName(provider);

    if (!normalizedProvider) {
      throw createProjectGuardrailsServiceError("invalid_allowed_provider");
    }

    return normalizedProvider;
  });

  return sortProviderNames([...new Set(normalizedProviders)]);
}

function buildManagedPreferredProviderConditions(provider: ProviderName) {
  return {
    version: MANAGED_RULE_VERSION,
    provider,
  } satisfies Record<string, unknown>;
}

function buildManagedAllowedProvidersConditions(providers: ProviderName[]) {
  return {
    version: MANAGED_RULE_VERSION,
    providers,
  } satisfies Record<string, unknown>;
}

function hasManagedPreferredProviderConditions(
  conditionsJson: Record<string, unknown>,
  provider: ProviderName,
) {
  const keys = Object.keys(conditionsJson).sort();

  return (
    keys.length === 2 &&
    keys[0] === "provider" &&
    keys[1] === "version" &&
    conditionsJson.version === MANAGED_RULE_VERSION &&
    conditionsJson.provider === provider
  );
}

function hasManagedAllowedProvidersConditions(
  conditionsJson: Record<string, unknown>,
  providers: ProviderName[],
) {
  const keys = Object.keys(conditionsJson).sort();
  const storedProviders = parseAllowedProviders(conditionsJson);

  return (
    keys.length === 2 &&
    keys[0] === "providers" &&
    keys[1] === "version" &&
    conditionsJson.version === MANAGED_RULE_VERSION &&
    storedProviders.length === providers.length &&
    storedProviders.every((provider, index) => provider === providers[index])
  );
}

async function requireWorkspaceExists(
  db: ProjectGuardrailsServiceDatabase,
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
    throw createProjectGuardrailsServiceError("workspace_not_found");
  }
}

async function requireProjectExists(
  db: ProjectGuardrailsServiceDatabase,
  input: {
    workspaceId: string;
    projectId: string;
  },
) {
  const [project] = await db
    .select({
      id: projects.id,
    })
    .from(projects)
    .where(
      and(
        eq(projects.workspaceId, input.workspaceId),
        eq(projects.id, input.projectId),
      ),
    )
    .limit(1);

  if (!project) {
    throw createProjectGuardrailsServiceError("project_not_found");
  }
}

async function selectProjectPolicyRules(
  db: ProjectGuardrailsServiceDatabase,
  input: {
    workspaceId: string;
    projectId: string;
    ruleType: "preferred_provider" | "allow_provider";
  },
) {
  return db
    .select({
      id: policyRules.id,
      workspaceId: policyRules.workspaceId,
      projectId: policyRules.projectId,
      name: policyRules.name,
      ruleType: policyRules.ruleType,
      status: policyRules.status,
      enforcementMode: policyRules.enforcementMode,
      conditionsJson: policyRules.conditionsJson,
      createdAt: policyRules.createdAt,
      updatedAt: policyRules.updatedAt,
    })
    .from(policyRules)
    .where(
      and(
        eq(policyRules.workspaceId, input.workspaceId),
        eq(policyRules.projectId, input.projectId),
        eq(policyRules.ruleType, input.ruleType),
      ),
    )
    .orderBy(asc(policyRules.name), asc(policyRules.id));
}

async function selectActiveScopedPolicyRules(
  db: ProjectGuardrailsServiceDatabase,
  input: {
    workspaceId: string;
    projectId: string;
  },
) {
  return db
    .select({
      id: policyRules.id,
      workspaceId: policyRules.workspaceId,
      projectId: policyRules.projectId,
      name: policyRules.name,
      ruleType: policyRules.ruleType,
      status: policyRules.status,
      enforcementMode: policyRules.enforcementMode,
      conditionsJson: policyRules.conditionsJson,
      createdAt: policyRules.createdAt,
      updatedAt: policyRules.updatedAt,
    })
    .from(policyRules)
    .where(
      and(
        eq(policyRules.workspaceId, input.workspaceId),
        eq(policyRules.status, "active"),
        or(
          isNull(policyRules.projectId),
          eq(policyRules.projectId, input.projectId),
        ),
      ),
    )
    .orderBy(
      asc(policyRules.projectId),
      asc(policyRules.ruleType),
      asc(policyRules.name),
      asc(policyRules.id),
    );
}

function summarizePreferredProvider(
  workspaceId: string,
  projectId: string,
  rows: ProjectPolicyRuleRow[],
): PreferredProviderSummary {
  const effectiveRule = rows
    .map((row) => ({
      row,
      provider: isRecord(row.conditionsJson)
        ? parsePreferredProvider(row.conditionsJson)
        : null,
    }))
    .find(
      (
        entry,
      ): entry is {
        row: ProjectPolicyRuleRow;
        provider: ProviderName;
      } => entry.row.status === "active" && entry.provider !== null,
    );

  if (!effectiveRule) {
    return {
      workspaceId,
      projectId,
      policyRuleId: null,
      provider: null,
      enabled: false,
      updatedAt: null,
    };
  }

  return {
    workspaceId,
    projectId,
    policyRuleId: effectiveRule.row.id,
    provider: effectiveRule.provider,
    enabled: true,
    updatedAt: effectiveRule.row.updatedAt.toISOString(),
  };
}

function summarizeAllowedProviders(
  workspaceId: string,
  projectId: string,
  rows: ProjectPolicyRuleRow[],
): AllowedProvidersSummary {
  const activeRows = rows.filter(
    (row) => row.status === "active" && row.enforcementMode === "hard_block",
  );
  const activeProviders = sortProviderNames([
    ...new Set(
      activeRows.flatMap((row) =>
        isRecord(row.conditionsJson)
          ? parseAllowedProviders(row.conditionsJson)
          : [],
      ),
    ),
  ]);

  if (activeProviders.length === 0) {
    return {
      workspaceId,
      projectId,
      policyRuleId: null,
      providers: [],
      enabled: false,
      updatedAt: null,
    };
  }

  return {
    workspaceId,
    projectId,
    policyRuleId: activeRows[0]?.id ?? null,
    providers: activeProviders,
    enabled: true,
    updatedAt: activeRows[0]?.updatedAt.toISOString() ?? null,
  };
}

function summarizeUnmanagedPolicyWarnings(rows: ActiveScopedPolicyRuleRow[]) {
  return {
    count: rows.length,
    ruleTypes: [...new Set(rows.map((row) => row.ruleType))].sort(),
  } satisfies UnmanagedPolicyWarningSummary;
}

function isManagedWorkspaceBudgetCapRow(row: ActiveScopedPolicyRuleRow) {
  return (
    row.projectId === null &&
    row.ruleType === "budget_cap" &&
    row.enforcementMode === "hard_block" &&
    isRecord(row.conditionsJson) &&
    typeof parseBudgetCapLimit(row.conditionsJson.limitUsd) === "number"
  );
}

function isManagedProjectPreferredProviderRow(
  row: ActiveScopedPolicyRuleRow,
  projectId: string,
) {
  return (
    row.projectId === projectId &&
    row.ruleType === "preferred_provider" &&
    isRecord(row.conditionsJson) &&
    parsePreferredProvider(row.conditionsJson) !== null
  );
}

function isManagedProjectAllowedProvidersRow(
  row: ActiveScopedPolicyRuleRow,
  projectId: string,
) {
  return (
    row.projectId === projectId &&
    row.ruleType === "allow_provider" &&
    row.enforcementMode === "hard_block" &&
    isRecord(row.conditionsJson) &&
    parseAllowedProviders(row.conditionsJson).length > 0
  );
}

async function insertProjectGuardrailAuditEvent(
  db: ProjectGuardrailsServiceDatabase,
  input: {
    workspaceId: string;
    projectId: string;
    eventType:
      | "project.preferred_provider_updated"
      | "project.preferred_provider_cleared"
      | "project.allowed_providers_updated"
      | "project.allowed_providers_cleared";
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
    entityType: "project",
    entityId: input.projectId,
    eventPayload: input.eventPayload,
    createdAt: input.createdAt,
  });
}

export async function upsertProjectPreferredProvider(
  input: {
    workspaceId: string;
    projectId: string;
    provider: ProviderName | null;
  },
  database?: Database,
): Promise<PreferredProviderSummary> {
  return withDatabase(database, async (db) => {
    const provider = normalizePreferredProviderInput(input.provider);

    await requireWorkspaceExists(db, input.workspaceId);
    await requireProjectExists(db, input);

    return db.transaction(async (tx) => {
      const rows = await selectProjectPolicyRules(tx, {
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        ruleType: "preferred_provider",
      });
      const previousSummary = summarizePreferredProvider(
        input.workspaceId,
        input.projectId,
        rows,
      );
      const now = new Date();
      const activeRuleIds = rows
        .filter((row) => row.status === "active")
        .map((row) => row.id);

      if (provider === null) {
        if (activeRuleIds.length === 0) {
          return previousSummary;
        }

        await tx
          .update(policyRules)
          .set({
            status: "inactive",
            updatedAt: now,
          })
          .where(inArray(policyRules.id, activeRuleIds));

        await insertProjectGuardrailAuditEvent(tx, {
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          eventType: "project.preferred_provider_cleared",
          eventPayload: {
            message: "Cleared the project preferred provider.",
            previous_provider: previousSummary.provider,
            deactivated_policy_rule_ids: activeRuleIds,
          },
          createdAt: now,
        });

        const nextRows = await selectProjectPolicyRules(tx, {
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          ruleType: "preferred_provider",
        });

        return summarizePreferredProvider(
          input.workspaceId,
          input.projectId,
          nextRows,
        );
      }

      const effectiveRule = rows
        .map((row) => ({
          row,
          provider: isRecord(row.conditionsJson)
            ? parsePreferredProvider(row.conditionsJson)
            : null,
        }))
        .find(
          (
            entry,
          ): entry is {
            row: ProjectPolicyRuleRow;
            provider: ProviderName;
          } => entry.row.status === "active" && entry.provider !== null,
        );
      const fallbackRule = rows[0] ?? null;
      const canonicalRule = effectiveRule?.row ?? fallbackRule;
      const canonicalRuleId = canonicalRule?.id ?? randomUUID();
      const extraActiveRuleIds = rows
        .filter(
          (row) => row.status === "active" && row.id !== canonicalRule?.id,
        )
        .map((row) => row.id);
      const managedConditions =
        buildManagedPreferredProviderConditions(provider);
      const needsInsert = !canonicalRule;
      const needsUpdate =
        !needsInsert &&
        (!isRecord(canonicalRule.conditionsJson) ||
          canonicalRule.name !== PROJECT_PREFERRED_PROVIDER_RULE_NAME ||
          canonicalRule.status !== "active" ||
          canonicalRule.enforcementMode !== "soft_warn" ||
          !hasManagedPreferredProviderConditions(
            canonicalRule.conditionsJson,
            provider,
          ));
      const shouldMutate =
        needsInsert || needsUpdate || extraActiveRuleIds.length > 0;

      if (!shouldMutate) {
        return previousSummary;
      }

      if (needsInsert) {
        await tx.insert(policyRules).values({
          id: canonicalRuleId,
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          name: PROJECT_PREFERRED_PROVIDER_RULE_NAME,
          ruleType: "preferred_provider",
          status: "active",
          enforcementMode: "soft_warn",
          conditionsJson: managedConditions,
          createdAt: now,
          updatedAt: now,
        });
      } else if (needsUpdate) {
        await tx
          .update(policyRules)
          .set({
            name: PROJECT_PREFERRED_PROVIDER_RULE_NAME,
            status: "active",
            enforcementMode: "soft_warn",
            conditionsJson: managedConditions,
            updatedAt: now,
          })
          .where(eq(policyRules.id, canonicalRuleId));
      }

      if (extraActiveRuleIds.length > 0) {
        await tx
          .update(policyRules)
          .set({
            status: "inactive",
            updatedAt: now,
          })
          .where(inArray(policyRules.id, extraActiveRuleIds));
      }

      await insertProjectGuardrailAuditEvent(tx, {
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        eventType: "project.preferred_provider_updated",
        eventPayload: {
          message: `Set the project preferred provider to ${provider}.`,
          provider,
          previous_provider: previousSummary.provider,
          policy_rule_id: canonicalRuleId,
          deactivated_policy_rule_ids: extraActiveRuleIds,
        },
        createdAt: now,
      });

      const nextRows = await selectProjectPolicyRules(tx, {
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        ruleType: "preferred_provider",
      });

      return summarizePreferredProvider(
        input.workspaceId,
        input.projectId,
        nextRows,
      );
    });
  });
}

export async function upsertProjectAllowedProviders(
  input: {
    workspaceId: string;
    projectId: string;
    providers: ProviderName[];
  },
  database?: Database,
): Promise<AllowedProvidersSummary> {
  return withDatabase(database, async (db) => {
    const providers = normalizeAllowedProvidersInput(input.providers);

    await requireWorkspaceExists(db, input.workspaceId);
    await requireProjectExists(db, input);

    return db.transaction(async (tx) => {
      const rows = await selectProjectPolicyRules(tx, {
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        ruleType: "allow_provider",
      });
      const previousSummary = summarizeAllowedProviders(
        input.workspaceId,
        input.projectId,
        rows,
      );
      const now = new Date();
      const activeRuleIds = rows
        .filter((row) => row.status === "active")
        .map((row) => row.id);

      if (providers.length === 0) {
        if (activeRuleIds.length === 0) {
          return previousSummary;
        }

        await tx
          .update(policyRules)
          .set({
            status: "inactive",
            updatedAt: now,
          })
          .where(inArray(policyRules.id, activeRuleIds));

        await insertProjectGuardrailAuditEvent(tx, {
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          eventType: "project.allowed_providers_cleared",
          eventPayload: {
            message: "Cleared the project allowed providers restriction.",
            previous_providers: previousSummary.providers,
            deactivated_policy_rule_ids: activeRuleIds,
          },
          createdAt: now,
        });

        const nextRows = await selectProjectPolicyRules(tx, {
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          ruleType: "allow_provider",
        });

        return summarizeAllowedProviders(
          input.workspaceId,
          input.projectId,
          nextRows,
        );
      }

      const effectiveRule = rows
        .map((row) => ({
          row,
          providers: isRecord(row.conditionsJson)
            ? parseAllowedProviders(row.conditionsJson)
            : [],
        }))
        .find(
          (
            entry,
          ): entry is {
            row: ProjectPolicyRuleRow;
            providers: ProviderName[];
          } =>
            entry.row.status === "active" &&
            entry.row.enforcementMode === "hard_block" &&
            entry.providers.length > 0,
        );
      const fallbackRule = rows[0] ?? null;
      const canonicalRule = effectiveRule?.row ?? fallbackRule;
      const canonicalRuleId = canonicalRule?.id ?? randomUUID();
      const extraActiveRuleIds = rows
        .filter(
          (row) => row.status === "active" && row.id !== canonicalRule?.id,
        )
        .map((row) => row.id);
      const managedConditions =
        buildManagedAllowedProvidersConditions(providers);
      const needsInsert = !canonicalRule;
      const needsUpdate =
        !needsInsert &&
        (!isRecord(canonicalRule.conditionsJson) ||
          canonicalRule.name !== PROJECT_ALLOWED_PROVIDERS_RULE_NAME ||
          canonicalRule.status !== "active" ||
          canonicalRule.enforcementMode !== "hard_block" ||
          !hasManagedAllowedProvidersConditions(
            canonicalRule.conditionsJson,
            providers,
          ));
      const shouldMutate =
        needsInsert || needsUpdate || extraActiveRuleIds.length > 0;

      if (!shouldMutate) {
        return previousSummary;
      }

      if (needsInsert) {
        await tx.insert(policyRules).values({
          id: canonicalRuleId,
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          name: PROJECT_ALLOWED_PROVIDERS_RULE_NAME,
          ruleType: "allow_provider",
          status: "active",
          enforcementMode: "hard_block",
          conditionsJson: managedConditions,
          createdAt: now,
          updatedAt: now,
        });
      } else if (needsUpdate) {
        await tx
          .update(policyRules)
          .set({
            name: PROJECT_ALLOWED_PROVIDERS_RULE_NAME,
            status: "active",
            enforcementMode: "hard_block",
            conditionsJson: managedConditions,
            updatedAt: now,
          })
          .where(eq(policyRules.id, canonicalRuleId));
      }

      if (extraActiveRuleIds.length > 0) {
        await tx
          .update(policyRules)
          .set({
            status: "inactive",
            updatedAt: now,
          })
          .where(inArray(policyRules.id, extraActiveRuleIds));
      }

      await insertProjectGuardrailAuditEvent(tx, {
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        eventType: "project.allowed_providers_updated",
        eventPayload: {
          message: `Set the project allowed providers to ${providers.join(", ")}.`,
          providers,
          previous_providers: previousSummary.providers,
          policy_rule_id: canonicalRuleId,
          deactivated_policy_rule_ids: extraActiveRuleIds,
        },
        createdAt: now,
      });

      const nextRows = await selectProjectPolicyRules(tx, {
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        ruleType: "allow_provider",
      });

      return summarizeAllowedProviders(
        input.workspaceId,
        input.projectId,
        nextRows,
      );
    });
  });
}

export async function getProjectGuardrailsForAdmin(
  input: {
    workspaceId: string;
    projectId: string;
  },
  database?: Database,
): Promise<ProjectGuardrailsForAdmin> {
  return withDatabase(database, async (db) => {
    await requireWorkspaceExists(db, input.workspaceId);
    await requireProjectExists(db, input);

    const [
      workspaceBudgetCap,
      activeScopedRules,
      preferredProviderRows,
      allowedProviderRows,
    ] = await Promise.all([
      getWorkspaceBudgetCap(input.workspaceId, db),
      selectActiveScopedPolicyRules(db, input),
      selectProjectPolicyRules(db, {
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        ruleType: "preferred_provider",
      }),
      selectProjectPolicyRules(db, {
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        ruleType: "allow_provider",
      }),
    ]);

    const unmanagedWorkspaceRules = activeScopedRules.filter(
      (row) => row.projectId === null && !isManagedWorkspaceBudgetCapRow(row),
    );
    const unmanagedProjectRules = activeScopedRules.filter(
      (row) =>
        row.projectId === input.projectId &&
        !isManagedProjectPreferredProviderRow(row, input.projectId) &&
        !isManagedProjectAllowedProvidersRow(row, input.projectId),
    );

    return {
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      workspaceBudgetCap,
      preferredProvider: summarizePreferredProvider(
        input.workspaceId,
        input.projectId,
        preferredProviderRows,
      ),
      allowedProviders: summarizeAllowedProviders(
        input.workspaceId,
        input.projectId,
        allowedProviderRows,
      ),
      unmanagedPolicyWarnings: {
        workspace: summarizeUnmanagedPolicyWarnings(unmanagedWorkspaceRules),
        project: summarizeUnmanagedPolicyWarnings(unmanagedProjectRules),
      },
    };
  });
}
