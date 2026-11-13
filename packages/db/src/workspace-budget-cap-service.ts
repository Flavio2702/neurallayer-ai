import { randomUUID } from "node:crypto";

import { and, asc, eq, inArray, isNull } from "drizzle-orm";

import type { Database } from "./client";
import { withDatabase } from "./connection-helpers";
import { auditEvents, policyRules, workspaces } from "./schema";

type DatabaseTransaction = Parameters<
  Parameters<Database["transaction"]>[0]
>[0];
type WorkspaceBudgetCapServiceDatabase = Database | DatabaseTransaction;

const WORKSPACE_BUDGET_CAP_RULE_NAME = "Workspace budget cap";
const WORKSPACE_BUDGET_CAP_RULE_VERSION = 1;

type WorkspaceBudgetCapRuleRow = Awaited<
  ReturnType<typeof selectWorkspaceBudgetCapRules>
>[number];

type ResolvedBudgetCapRule = {
  row: WorkspaceBudgetCapRuleRow;
  limitUsd: number;
};

export type WorkspaceBudgetCapSummary = {
  workspaceId: string;
  policyRuleId: string | null;
  limitUsd: number | null;
  enabled: boolean;
  updatedAt: string | null;
};

export type WorkspaceBudgetCapServiceErrorCode =
  | "workspace_not_found"
  | "invalid_budget_cap_limit";

export class WorkspaceBudgetCapServiceError extends Error {
  readonly code: WorkspaceBudgetCapServiceErrorCode;

  constructor(code: WorkspaceBudgetCapServiceErrorCode, message: string) {
    super(message);
    this.name = "WorkspaceBudgetCapServiceError";
    this.code = code;
  }
}

function createWorkspaceBudgetCapServiceError(
  code: WorkspaceBudgetCapServiceErrorCode,
) {
  switch (code) {
    case "workspace_not_found":
      return new WorkspaceBudgetCapServiceError(
        code,
        "The requested workspace does not exist.",
      );
    case "invalid_budget_cap_limit":
      return new WorkspaceBudgetCapServiceError(
        code,
        "Workspace budget cap must be a finite number greater than or equal to zero.",
      );
    default:
      return new WorkspaceBudgetCapServiceError(
        "invalid_budget_cap_limit",
        "Workspace budget cap must be a finite number greater than or equal to zero.",
      );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function validateBudgetCapLimit(limitUsd: number | null) {
  if (limitUsd === null) {
    return null;
  }

  if (!Number.isFinite(limitUsd) || limitUsd < 0) {
    throw createWorkspaceBudgetCapServiceError("invalid_budget_cap_limit");
  }

  return limitUsd;
}

function buildManagedBudgetCapConditions(limitUsd: number) {
  return {
    version: WORKSPACE_BUDGET_CAP_RULE_VERSION,
    limitUsd,
  } satisfies Record<string, unknown>;
}

function hasManagedBudgetCapConditions(
  conditionsJson: Record<string, unknown>,
  limitUsd: number,
) {
  const keys = Object.keys(conditionsJson).sort();

  return (
    keys.length === 2 &&
    keys[0] === "limitUsd" &&
    keys[1] === "version" &&
    conditionsJson.version === WORKSPACE_BUDGET_CAP_RULE_VERSION &&
    typeof conditionsJson.limitUsd === "number" &&
    conditionsJson.limitUsd === limitUsd
  );
}

function toIsoString(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

async function requireWorkspaceExists(
  db: WorkspaceBudgetCapServiceDatabase,
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
    throw createWorkspaceBudgetCapServiceError("workspace_not_found");
  }
}

async function selectWorkspaceBudgetCapRules(
  db: WorkspaceBudgetCapServiceDatabase,
  workspaceId: string,
) {
  return db
    .select({
      id: policyRules.id,
      workspaceId: policyRules.workspaceId,
      name: policyRules.name,
      status: policyRules.status,
      conditionsJson: policyRules.conditionsJson,
      createdAt: policyRules.createdAt,
      updatedAt: policyRules.updatedAt,
    })
    .from(policyRules)
    .where(
      and(
        eq(policyRules.workspaceId, workspaceId),
        isNull(policyRules.projectId),
        eq(policyRules.ruleType, "budget_cap"),
        eq(policyRules.enforcementMode, "hard_block"),
      ),
    )
    .orderBy(asc(policyRules.createdAt), asc(policyRules.id));
}

function resolveEffectiveBudgetCapRule(rows: WorkspaceBudgetCapRuleRow[]) {
  const activeValidRows = rows
    .map((row) => ({
      row,
      limitUsd: isRecord(row.conditionsJson)
        ? parseBudgetCapLimit(row.conditionsJson.limitUsd)
        : undefined,
    }))
    .filter(
      (
        entry,
      ): entry is {
        row: WorkspaceBudgetCapRuleRow;
        limitUsd: number;
      } => entry.row.status === "active" && typeof entry.limitUsd === "number",
    );

  activeValidRows.sort((left, right) => {
    if (left.limitUsd !== right.limitUsd) {
      return left.limitUsd - right.limitUsd;
    }

    const nameComparison = left.row.name.localeCompare(right.row.name);

    if (nameComparison !== 0) {
      return nameComparison;
    }

    return left.row.id.localeCompare(right.row.id);
  });

  return activeValidRows[0] ?? null;
}

function summarizeWorkspaceBudgetCap(
  workspaceId: string,
  rows: WorkspaceBudgetCapRuleRow[],
): WorkspaceBudgetCapSummary {
  const effectiveRule = resolveEffectiveBudgetCapRule(rows);

  if (!effectiveRule) {
    return {
      workspaceId,
      policyRuleId: null,
      limitUsd: null,
      enabled: false,
      updatedAt: null,
    };
  }

  return {
    workspaceId,
    policyRuleId: effectiveRule.row.id,
    limitUsd: effectiveRule.limitUsd,
    enabled: true,
    updatedAt: effectiveRule.row.updatedAt.toISOString(),
  };
}

function findFallbackCanonicalRule(rows: WorkspaceBudgetCapRuleRow[]) {
  return rows[0] ?? null;
}

async function insertWorkspaceBudgetCapAuditEvent(
  db: WorkspaceBudgetCapServiceDatabase,
  input: {
    workspaceId: string;
    eventType: "workspace.budget_cap_updated" | "workspace.budget_cap_cleared";
    eventPayload: Record<string, unknown>;
    createdAt: Date;
  },
) {
  await db.insert(auditEvents).values({
    id: randomUUID(),
    workspaceId: input.workspaceId,
    actorType: "system",
    eventType: input.eventType,
    entityType: "workspace",
    entityId: input.workspaceId,
    eventPayload: input.eventPayload,
    createdAt: input.createdAt,
  });
}

export async function getWorkspaceBudgetCap(
  workspaceId: string,
  database?: Database,
): Promise<WorkspaceBudgetCapSummary> {
  return withDatabase(database, async (db) => {
    await requireWorkspaceExists(db, workspaceId);

    const rows = await selectWorkspaceBudgetCapRules(db, workspaceId);

    return summarizeWorkspaceBudgetCap(workspaceId, rows);
  });
}

export async function upsertWorkspaceBudgetCap(
  input: {
    workspaceId: string;
    limitUsd: number | null;
  },
  database?: Database,
): Promise<WorkspaceBudgetCapSummary> {
  return withDatabase(database, async (db) => {
    const limitUsd = validateBudgetCapLimit(input.limitUsd);

    await requireWorkspaceExists(db, input.workspaceId);

    return db.transaction(async (tx) => {
      const rows = await selectWorkspaceBudgetCapRules(tx, input.workspaceId);
      const previousSummary = summarizeWorkspaceBudgetCap(
        input.workspaceId,
        rows,
      );
      const now = new Date();

      if (limitUsd === null) {
        const activeRuleIds = rows
          .filter((row) => row.status === "active")
          .map((row) => row.id);

        if (activeRuleIds.length === 0) {
          return previousSummary.enabled
            ? {
                workspaceId: input.workspaceId,
                policyRuleId: null,
                limitUsd: null,
                enabled: false,
                updatedAt: null,
              }
            : previousSummary;
        }

        await tx
          .update(policyRules)
          .set({
            status: "inactive",
            updatedAt: now,
          })
          .where(inArray(policyRules.id, activeRuleIds));

        await insertWorkspaceBudgetCapAuditEvent(tx, {
          workspaceId: input.workspaceId,
          eventType: "workspace.budget_cap_cleared",
          eventPayload: {
            message: "Cleared the workspace budget cap.",
            previous_limit_usd: previousSummary.limitUsd,
            deactivated_policy_rule_ids: activeRuleIds,
          },
          createdAt: now,
        });

        return {
          workspaceId: input.workspaceId,
          policyRuleId: null,
          limitUsd: null,
          enabled: false,
          updatedAt: null,
        };
      }

      const effectiveRule = resolveEffectiveBudgetCapRule(rows);
      const fallbackRule = findFallbackCanonicalRule(rows);
      const canonicalRule = effectiveRule?.row ?? fallbackRule;
      const managedConditions = buildManagedBudgetCapConditions(limitUsd);
      const extraActiveRuleIds = rows
        .filter(
          (row) => row.status === "active" && row.id !== canonicalRule?.id,
        )
        .map((row) => row.id);
      const needsCanonicalInsert = !canonicalRule;
      const needsCanonicalUpdate =
        !needsCanonicalInsert &&
        (!isRecord(canonicalRule.conditionsJson) ||
          canonicalRule.name !== WORKSPACE_BUDGET_CAP_RULE_NAME ||
          canonicalRule.status !== "active" ||
          !hasManagedBudgetCapConditions(
            canonicalRule.conditionsJson,
            limitUsd,
          ));
      const shouldAudit =
        needsCanonicalInsert ||
        needsCanonicalUpdate ||
        extraActiveRuleIds.length > 0;
      const canonicalRuleId = canonicalRule?.id ?? randomUUID();

      if (needsCanonicalInsert) {
        await tx.insert(policyRules).values({
          id: canonicalRuleId,
          workspaceId: input.workspaceId,
          projectId: null,
          name: WORKSPACE_BUDGET_CAP_RULE_NAME,
          ruleType: "budget_cap",
          status: "active",
          enforcementMode: "hard_block",
          conditionsJson: managedConditions,
          createdAt: now,
          updatedAt: now,
        });
      } else if (needsCanonicalUpdate) {
        await tx
          .update(policyRules)
          .set({
            name: WORKSPACE_BUDGET_CAP_RULE_NAME,
            status: "active",
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

      if (shouldAudit) {
        await insertWorkspaceBudgetCapAuditEvent(tx, {
          workspaceId: input.workspaceId,
          eventType: "workspace.budget_cap_updated",
          eventPayload: {
            message: `Set the workspace budget cap to ${limitUsd} USD.`,
            limit_usd: limitUsd,
            previous_limit_usd: previousSummary.limitUsd,
            policy_rule_id: canonicalRuleId,
            deactivated_policy_rule_ids: extraActiveRuleIds,
          },
          createdAt: now,
        });
      }

      return {
        workspaceId: input.workspaceId,
        policyRuleId: canonicalRuleId,
        limitUsd,
        enabled: true,
        updatedAt:
          needsCanonicalInsert || needsCanonicalUpdate
            ? now.toISOString()
            : toIsoString(canonicalRule?.updatedAt),
      };
    });
  });
}
