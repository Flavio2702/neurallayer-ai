import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { type TestContext, test } from "node:test";

import { loadDatabaseConfig } from "@neuralayer/config";
import { and, asc, eq, isNull } from "drizzle-orm";

import { createDbConnection, type Database } from "./client";
import { auditEvents, policyRules, projects, workspaces } from "./schema";
import {
  getWorkspaceBudgetCap,
  upsertWorkspaceBudgetCap,
  WorkspaceBudgetCapServiceError,
} from "./workspace-budget-cap-service";

async function openIntegrationDatabase(t: TestContext) {
  const {
    database: { url },
  } = loadDatabaseConfig();
  const { db, queryClient } = createDbConnection(url);

  try {
    await db.select({ id: workspaces.id }).from(workspaces).limit(1);
  } catch (error) {
    await queryClient.end({ timeout: 5 });
    t.skip(
      `Configured database is unavailable for integration tests: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return null;
  }

  t.after(async () => {
    await queryClient.end({ timeout: 5 });
  });

  return { db };
}

async function insertWorkspace(database: Database, suffix: string) {
  const workspaceId = `ws_budget_cap_${suffix}`;

  await database.insert(workspaces).values({
    id: workspaceId,
    name: `Workspace Budget Cap ${suffix}`,
    slug: `workspace-budget-cap-${suffix}`,
    status: "active",
    defaultMode: "balanced",
  });

  return workspaceId;
}

async function insertProject(
  database: Database,
  input: {
    workspaceId: string;
    projectId: string;
  },
) {
  await database.insert(projects).values({
    id: input.projectId,
    workspaceId: input.workspaceId,
    name: `Project ${input.projectId}`,
    slug: `project-${input.projectId}`,
    status: "active",
    defaultMode: "balanced",
  });
}

async function insertBudgetCapRule(
  database: Database,
  input: {
    id: string;
    workspaceId: string;
    projectId?: string | null;
    name: string;
    status?: "active" | "inactive";
    conditionsJson: Record<string, unknown>;
    createdAt?: Date;
  },
) {
  const createdAt = input.createdAt ?? new Date();

  await database.insert(policyRules).values({
    id: input.id,
    workspaceId: input.workspaceId,
    projectId: input.projectId ?? null,
    name: input.name,
    ruleType: "budget_cap",
    status: input.status ?? "active",
    enforcementMode: "hard_block",
    conditionsJson: input.conditionsJson,
    createdAt,
    updatedAt: createdAt,
  });
}

async function listWorkspaceBudgetCapRules(
  database: Database,
  workspaceId: string,
) {
  return database.query.policyRules.findMany({
    where: (table, { and, eq, isNull }) =>
      and(
        eq(table.workspaceId, workspaceId),
        isNull(table.projectId),
        eq(table.ruleType, "budget_cap"),
        eq(table.enforcementMode, "hard_block"),
      ),
    orderBy: (table, { asc }) => [asc(table.createdAt), asc(table.id)],
  });
}

async function listWorkspaceBudgetCapAuditEvents(
  database: Database,
  workspaceId: string,
) {
  return database.query.auditEvents.findMany({
    where: (table, { and, eq }) =>
      and(
        eq(table.workspaceId, workspaceId),
        eq(table.entityType, "workspace"),
        eq(table.entityId, workspaceId),
      ),
    orderBy: (table, { asc }) => [asc(table.createdAt), asc(table.id)],
  });
}

async function cleanupWorkspace(database: Database, workspaceId: string) {
  await database
    .delete(auditEvents)
    .where(eq(auditEvents.workspaceId, workspaceId));
  await database
    .delete(policyRules)
    .where(eq(policyRules.workspaceId, workspaceId));
  await database.delete(projects).where(eq(projects.workspaceId, workspaceId));
  await database.delete(workspaces).where(eq(workspaces.id, workspaceId));
}

test("getWorkspaceBudgetCap returns an unset summary when no workspace-level budget cap is configured", async (t) => {
  const connection = await openIntegrationDatabase(t);

  if (!connection) {
    return;
  }

  const suffix = randomUUID().slice(0, 8);
  const workspaceId = await insertWorkspace(connection.db, suffix);

  try {
    const summary = await getWorkspaceBudgetCap(workspaceId, connection.db);

    assert.deepEqual(summary, {
      workspaceId,
      policyRuleId: null,
      limitUsd: null,
      enabled: false,
      updatedAt: null,
    });
  } finally {
    await cleanupWorkspace(connection.db, workspaceId);
  }
});

test("upsertWorkspaceBudgetCap creates the managed workspace-level policy rule and audits the change", async (t) => {
  const connection = await openIntegrationDatabase(t);

  if (!connection) {
    return;
  }

  const suffix = randomUUID().slice(0, 8);
  const workspaceId = await insertWorkspace(connection.db, suffix);

  try {
    const summary = await upsertWorkspaceBudgetCap(
      {
        workspaceId,
        limitUsd: 125,
      },
      connection.db,
    );
    const storedRules = await listWorkspaceBudgetCapRules(
      connection.db,
      workspaceId,
    );
    const auditLog = await listWorkspaceBudgetCapAuditEvents(
      connection.db,
      workspaceId,
    );

    assert.equal(summary.enabled, true);
    assert.equal(summary.limitUsd, 125);
    assert.equal(summary.policyRuleId, storedRules[0]?.id ?? null);
    assert.equal(storedRules.length, 1);
    assert.equal(storedRules[0]?.name, "Workspace budget cap");
    assert.equal(storedRules[0]?.status, "active");
    assert.equal(storedRules[0]?.projectId, null);
    assert.deepEqual(storedRules[0]?.conditionsJson, {
      version: 1,
      limitUsd: 125,
    });
    assert.equal(auditLog.length, 1);
    assert.equal(auditLog[0]?.eventType, "workspace.budget_cap_updated");
    assert.deepEqual(auditLog[0]?.eventPayload, {
      message: "Set the workspace budget cap to 125 USD.",
      limit_usd: 125,
      previous_limit_usd: null,
      policy_rule_id: storedRules[0]?.id,
      deactivated_policy_rule_ids: [],
    });
  } finally {
    await cleanupWorkspace(connection.db, workspaceId);
  }
});

test("upsertWorkspaceBudgetCap updates the effective rule, stays idempotent on no-op writes, and audits only real changes", async (t) => {
  const connection = await openIntegrationDatabase(t);

  if (!connection) {
    return;
  }

  const suffix = randomUUID().slice(0, 8);
  const workspaceId = await insertWorkspace(connection.db, suffix);

  try {
    const firstSummary = await upsertWorkspaceBudgetCap(
      {
        workspaceId,
        limitUsd: 100,
      },
      connection.db,
    );
    const secondSummary = await upsertWorkspaceBudgetCap(
      {
        workspaceId,
        limitUsd: 80,
      },
      connection.db,
    );
    const thirdSummary = await upsertWorkspaceBudgetCap(
      {
        workspaceId,
        limitUsd: 80,
      },
      connection.db,
    );
    const storedRules = await listWorkspaceBudgetCapRules(
      connection.db,
      workspaceId,
    );
    const auditLog = await listWorkspaceBudgetCapAuditEvents(
      connection.db,
      workspaceId,
    );

    assert.equal(firstSummary.policyRuleId, secondSummary.policyRuleId);
    assert.equal(secondSummary.policyRuleId, thirdSummary.policyRuleId);
    assert.equal(secondSummary.limitUsd, 80);
    assert.equal(thirdSummary.limitUsd, 80);
    assert.equal(secondSummary.updatedAt, thirdSummary.updatedAt);
    assert.equal(storedRules.length, 1);
    assert.deepEqual(storedRules[0]?.conditionsJson, {
      version: 1,
      limitUsd: 80,
    });
    assert.deepEqual(
      auditLog.map((event) => event.eventType),
      ["workspace.budget_cap_updated", "workspace.budget_cap_updated"],
    );
  } finally {
    await cleanupWorkspace(connection.db, workspaceId);
  }
});

test("upsertWorkspaceBudgetCap consolidates duplicate active workspace-level caps onto the currently effective rule", async (t) => {
  const connection = await openIntegrationDatabase(t);

  if (!connection) {
    return;
  }

  const suffix = randomUUID().slice(0, 8);
  const workspaceId = await insertWorkspace(connection.db, suffix);
  const highRuleId = `pol_budget_high_${suffix}`;
  const lowRuleId = `pol_budget_low_${suffix}`;
  const invalidRuleId = `pol_budget_invalid_${suffix}`;

  try {
    await insertBudgetCapRule(connection.db, {
      id: highRuleId,
      workspaceId,
      name: "Legacy high cap",
      conditionsJson: {
        limitUsd: 120,
      },
      createdAt: new Date("2026-03-24T09:00:00.000Z"),
    });
    await insertBudgetCapRule(connection.db, {
      id: lowRuleId,
      workspaceId,
      name: "Legacy low cap",
      conditionsJson: {
        limitUsd: 80,
      },
      createdAt: new Date("2026-03-24T10:00:00.000Z"),
    });
    await insertBudgetCapRule(connection.db, {
      id: invalidRuleId,
      workspaceId,
      name: "Legacy invalid cap",
      conditionsJson: {
        limitUsd: "not-a-number",
      },
      createdAt: new Date("2026-03-24T11:00:00.000Z"),
    });

    const summary = await upsertWorkspaceBudgetCap(
      {
        workspaceId,
        limitUsd: 75,
      },
      connection.db,
    );
    const storedRules = await listWorkspaceBudgetCapRules(
      connection.db,
      workspaceId,
    );
    const activeRules = storedRules.filter((rule) => rule.status === "active");

    assert.equal(summary.policyRuleId, lowRuleId);
    assert.equal(summary.limitUsd, 75);
    assert.equal(activeRules.length, 1);
    assert.equal(activeRules[0]?.id, lowRuleId);
    assert.equal(activeRules[0]?.name, "Workspace budget cap");
    assert.deepEqual(activeRules[0]?.conditionsJson, {
      version: 1,
      limitUsd: 75,
    });
    assert.equal(
      storedRules.find((rule) => rule.id === highRuleId)?.status,
      "inactive",
    );
    assert.equal(
      storedRules.find((rule) => rule.id === invalidRuleId)?.status,
      "inactive",
    );
  } finally {
    await cleanupWorkspace(connection.db, workspaceId);
  }
});

test("workspace budget cap reads and writes ignore project-scoped budget rules", async (t) => {
  const connection = await openIntegrationDatabase(t);

  if (!connection) {
    return;
  }

  const suffix = randomUUID().slice(0, 8);
  const workspaceId = await insertWorkspace(connection.db, suffix);
  const projectId = `proj_budget_scope_${suffix}`;
  const projectRuleId = `pol_project_budget_${suffix}`;

  try {
    await insertProject(connection.db, {
      workspaceId,
      projectId,
    });
    await insertBudgetCapRule(connection.db, {
      id: projectRuleId,
      workspaceId,
      projectId,
      name: "Project budget cap",
      conditionsJson: {
        limitUsd: 40,
      },
    });

    const initialSummary = await getWorkspaceBudgetCap(
      workspaceId,
      connection.db,
    );
    const updatedSummary = await upsertWorkspaceBudgetCap(
      {
        workspaceId,
        limitUsd: 150,
      },
      connection.db,
    );
    const projectScopedRule = await connection.db.query.policyRules.findFirst({
      where: (table, { and, eq }) =>
        and(eq(table.workspaceId, workspaceId), eq(table.id, projectRuleId)),
    });
    const workspaceScopedRules = await listWorkspaceBudgetCapRules(
      connection.db,
      workspaceId,
    );

    assert.deepEqual(initialSummary, {
      workspaceId,
      policyRuleId: null,
      limitUsd: null,
      enabled: false,
      updatedAt: null,
    });
    assert.equal(updatedSummary.enabled, true);
    assert.equal(updatedSummary.limitUsd, 150);
    assert.equal(workspaceScopedRules.length, 1);
    assert.equal(projectScopedRule?.status, "active");
    assert.deepEqual(projectScopedRule?.conditionsJson, {
      limitUsd: 40,
    });
  } finally {
    await cleanupWorkspace(connection.db, workspaceId);
  }
});

test("upsertWorkspaceBudgetCap clears the workspace cap by deactivating active workspace-level budget rules", async (t) => {
  const connection = await openIntegrationDatabase(t);

  if (!connection) {
    return;
  }

  const suffix = randomUUID().slice(0, 8);
  const workspaceId = await insertWorkspace(connection.db, suffix);
  const duplicateRuleId = `pol_budget_duplicate_${suffix}`;

  try {
    const createdSummary = await upsertWorkspaceBudgetCap(
      {
        workspaceId,
        limitUsd: 90,
      },
      connection.db,
    );

    await insertBudgetCapRule(connection.db, {
      id: duplicateRuleId,
      workspaceId,
      name: "Legacy duplicate cap",
      conditionsJson: {
        limitUsd: 120,
      },
      createdAt: new Date("2026-03-25T10:00:00.000Z"),
    });

    const clearedSummary = await upsertWorkspaceBudgetCap(
      {
        workspaceId,
        limitUsd: null,
      },
      connection.db,
    );
    const workspaceRules = await listWorkspaceBudgetCapRules(
      connection.db,
      workspaceId,
    );
    const auditLog = await listWorkspaceBudgetCapAuditEvents(
      connection.db,
      workspaceId,
    );

    assert.equal(createdSummary.enabled, true);
    assert.deepEqual(clearedSummary, {
      workspaceId,
      policyRuleId: null,
      limitUsd: null,
      enabled: false,
      updatedAt: null,
    });
    assert.equal(
      workspaceRules.filter((rule) => rule.status === "active").length,
      0,
    );
    assert.equal(
      auditLog[auditLog.length - 1]?.eventType,
      "workspace.budget_cap_cleared",
    );
    assert.deepEqual(
      (
        auditLog[auditLog.length - 1]?.eventPayload as {
          message?: string;
          previous_limit_usd?: number | null;
          deactivated_policy_rule_ids?: string[];
        }
      )?.deactivated_policy_rule_ids
        ?.slice()
        .sort(),
      [createdSummary.policyRuleId, duplicateRuleId].slice().sort(),
    );
    assert.deepEqual(
      {
        message: (
          auditLog[auditLog.length - 1]?.eventPayload as {
            message?: string;
          }
        )?.message,
        previous_limit_usd: (
          auditLog[auditLog.length - 1]?.eventPayload as {
            previous_limit_usd?: number | null;
          }
        )?.previous_limit_usd,
      },
      {
        message: "Cleared the workspace budget cap.",
        previous_limit_usd: 90,
      },
    );
  } finally {
    await cleanupWorkspace(connection.db, workspaceId);
  }
});

test("workspace budget cap services return typed errors for missing workspaces and invalid limits", async (t) => {
  const connection = await openIntegrationDatabase(t);

  if (!connection) {
    return;
  }

  const suffix = randomUUID().slice(0, 8);
  const workspaceId = await insertWorkspace(connection.db, suffix);

  try {
    await assert.rejects(
      getWorkspaceBudgetCap(`ws_missing_${suffix}`, connection.db),
      (error: unknown) =>
        error instanceof WorkspaceBudgetCapServiceError &&
        error.code === "workspace_not_found",
    );
    await assert.rejects(
      upsertWorkspaceBudgetCap(
        {
          workspaceId,
          limitUsd: -1,
        },
        connection.db,
      ),
      (error: unknown) =>
        error instanceof WorkspaceBudgetCapServiceError &&
        error.code === "invalid_budget_cap_limit",
    );
    await assert.rejects(
      upsertWorkspaceBudgetCap(
        {
          workspaceId: `ws_missing_${suffix}`,
          limitUsd: 10,
        },
        connection.db,
      ),
      (error: unknown) =>
        error instanceof WorkspaceBudgetCapServiceError &&
        error.code === "workspace_not_found",
    );
  } finally {
    await cleanupWorkspace(connection.db, workspaceId);
  }
});
