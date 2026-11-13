import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { type TestContext, test } from "node:test";

import { loadDatabaseConfig } from "@neuralayer/config";
import { asc, eq } from "drizzle-orm";

import { createDbConnection, type Database } from "./client";
import {
  getProjectGuardrailsForAdmin,
  ProjectGuardrailsServiceError,
  upsertProjectAllowedProviders,
  upsertProjectPreferredProvider,
} from "./project-guardrails-service";
import { auditEvents, policyRules, projects, workspaces } from "./schema";
import { upsertWorkspaceBudgetCap } from "./workspace-budget-cap-service";

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
  const workspaceId = `ws_project_guardrails_${suffix}`;

  await database.insert(workspaces).values({
    id: workspaceId,
    name: `Project Guardrails ${suffix}`,
    slug: `project-guardrails-${suffix}`,
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

async function insertPolicyRule(
  database: Database,
  input: {
    id: string;
    workspaceId: string;
    projectId?: string | null;
    name: string;
    ruleType:
      | "allow_model"
      | "deny_model"
      | "allow_provider"
      | "deny_provider"
      | "budget_cap"
      | "preferred_provider"
      | "mode_model_mapping";
    enforcementMode?: "hard_block" | "soft_warn";
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
    ruleType: input.ruleType,
    status: input.status ?? "active",
    enforcementMode: input.enforcementMode ?? "hard_block",
    conditionsJson: input.conditionsJson,
    createdAt,
    updatedAt: createdAt,
  });
}

async function listProjectPolicyRules(
  database: Database,
  input: {
    workspaceId: string;
    projectId: string;
    ruleType: "preferred_provider" | "allow_provider";
  },
) {
  return database.query.policyRules.findMany({
    where: (table, { and, eq }) =>
      and(
        eq(table.workspaceId, input.workspaceId),
        eq(table.projectId, input.projectId),
        eq(table.ruleType, input.ruleType),
      ),
    orderBy: (table, { asc }) => [asc(table.name), asc(table.id)],
  });
}

async function listProjectAuditEvents(
  database: Database,
  input: {
    workspaceId: string;
    projectId: string;
  },
) {
  return database.query.auditEvents.findMany({
    where: (table, { and, eq }) =>
      and(
        eq(table.workspaceId, input.workspaceId),
        eq(table.projectId, input.projectId),
        eq(table.entityType, "project"),
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

test("upsertProjectPreferredProvider creates, updates, clears, and audits only real changes", async (t) => {
  const connection = await openIntegrationDatabase(t);

  if (!connection) {
    return;
  }

  const suffix = randomUUID().slice(0, 8);
  const workspaceId = await insertWorkspace(connection.db, suffix);
  const projectId = `proj_project_guardrails_preferred_${suffix}`;

  try {
    await insertProject(connection.db, {
      workspaceId,
      projectId,
    });

    const createdSummary = await upsertProjectPreferredProvider(
      {
        workspaceId,
        projectId,
        provider: "openai",
      },
      connection.db,
    );
    const noOpSummary = await upsertProjectPreferredProvider(
      {
        workspaceId,
        projectId,
        provider: "openai",
      },
      connection.db,
    );
    const updatedSummary = await upsertProjectPreferredProvider(
      {
        workspaceId,
        projectId,
        provider: "anthropic",
      },
      connection.db,
    );
    const clearedSummary = await upsertProjectPreferredProvider(
      {
        workspaceId,
        projectId,
        provider: null,
      },
      connection.db,
    );
    const storedRules = await listProjectPolicyRules(connection.db, {
      workspaceId,
      projectId,
      ruleType: "preferred_provider",
    });
    const auditLog = await listProjectAuditEvents(connection.db, {
      workspaceId,
      projectId,
    });

    assert.equal(createdSummary.enabled, true);
    assert.equal(createdSummary.provider, "openai");
    assert.equal(createdSummary.policyRuleId, storedRules[0]?.id ?? null);
    assert.equal(noOpSummary.updatedAt, createdSummary.updatedAt);
    assert.equal(updatedSummary.policyRuleId, createdSummary.policyRuleId);
    assert.equal(updatedSummary.provider, "anthropic");
    assert.deepEqual(clearedSummary, {
      workspaceId,
      projectId,
      policyRuleId: null,
      provider: null,
      enabled: false,
      updatedAt: null,
    });
    assert.equal(storedRules.length, 1);
    assert.equal(storedRules[0]?.name, "Project preferred provider");
    assert.equal(storedRules[0]?.status, "inactive");
    assert.equal(storedRules[0]?.enforcementMode, "soft_warn");
    assert.deepEqual(storedRules[0]?.conditionsJson, {
      version: 1,
      provider: "anthropic",
    });
    assert.deepEqual(
      auditLog.map((event) => event.eventType),
      [
        "project.preferred_provider_updated",
        "project.preferred_provider_updated",
        "project.preferred_provider_cleared",
      ],
    );
    assert.deepEqual(auditLog[0]?.eventPayload, {
      message: "Set the project preferred provider to openai.",
      provider: "openai",
      previous_provider: null,
      policy_rule_id: createdSummary.policyRuleId,
      deactivated_policy_rule_ids: [],
    });
    assert.deepEqual(auditLog[1]?.eventPayload, {
      message: "Set the project preferred provider to anthropic.",
      provider: "anthropic",
      previous_provider: "openai",
      policy_rule_id: createdSummary.policyRuleId,
      deactivated_policy_rule_ids: [],
    });
    assert.deepEqual(auditLog[2]?.eventPayload, {
      message: "Cleared the project preferred provider.",
      previous_provider: "anthropic",
      deactivated_policy_rule_ids: [createdSummary.policyRuleId],
    });
  } finally {
    await cleanupWorkspace(connection.db, workspaceId);
  }
});

test("upsertProjectAllowedProviders normalizes order, stays idempotent, and clears on empty input", async (t) => {
  const connection = await openIntegrationDatabase(t);

  if (!connection) {
    return;
  }

  const suffix = randomUUID().slice(0, 8);
  const workspaceId = await insertWorkspace(connection.db, suffix);
  const projectId = `proj_project_guardrails_allowed_${suffix}`;

  try {
    await insertProject(connection.db, {
      workspaceId,
      projectId,
    });

    const createdSummary = await upsertProjectAllowedProviders(
      {
        workspaceId,
        projectId,
        providers: ["anthropic", "openai", "anthropic"],
      },
      connection.db,
    );
    const noOpSummary = await upsertProjectAllowedProviders(
      {
        workspaceId,
        projectId,
        providers: ["openai", "anthropic"],
      },
      connection.db,
    );
    const clearedSummary = await upsertProjectAllowedProviders(
      {
        workspaceId,
        projectId,
        providers: [],
      },
      connection.db,
    );
    const storedRules = await listProjectPolicyRules(connection.db, {
      workspaceId,
      projectId,
      ruleType: "allow_provider",
    });
    const auditLog = await listProjectAuditEvents(connection.db, {
      workspaceId,
      projectId,
    });

    assert.equal(createdSummary.enabled, true);
    assert.deepEqual(createdSummary.providers, ["openai", "anthropic"]);
    assert.equal(createdSummary.policyRuleId, storedRules[0]?.id ?? null);
    assert.equal(noOpSummary.updatedAt, createdSummary.updatedAt);
    assert.deepEqual(clearedSummary, {
      workspaceId,
      projectId,
      policyRuleId: null,
      providers: [],
      enabled: false,
      updatedAt: null,
    });
    assert.equal(storedRules.length, 1);
    assert.equal(storedRules[0]?.name, "Project allowed providers");
    assert.equal(storedRules[0]?.status, "inactive");
    assert.equal(storedRules[0]?.enforcementMode, "hard_block");
    assert.deepEqual(storedRules[0]?.conditionsJson, {
      version: 1,
      providers: ["openai", "anthropic"],
    });
    assert.deepEqual(
      auditLog.map((event) => event.eventType),
      [
        "project.allowed_providers_updated",
        "project.allowed_providers_cleared",
      ],
    );
    assert.deepEqual(auditLog[0]?.eventPayload, {
      message: "Set the project allowed providers to openai, anthropic.",
      providers: ["openai", "anthropic"],
      previous_providers: [],
      policy_rule_id: createdSummary.policyRuleId,
      deactivated_policy_rule_ids: [],
    });
    assert.deepEqual(auditLog[1]?.eventPayload, {
      message: "Cleared the project allowed providers restriction.",
      previous_providers: ["openai", "anthropic"],
      deactivated_policy_rule_ids: [createdSummary.policyRuleId],
    });
  } finally {
    await cleanupWorkspace(connection.db, workspaceId);
  }
});

test("upsertProjectAllowedProviders consolidates duplicate active rules and leaves unrelated policy types untouched", async (t) => {
  const connection = await openIntegrationDatabase(t);

  if (!connection) {
    return;
  }

  const suffix = randomUUID().slice(0, 8);
  const workspaceId = await insertWorkspace(connection.db, suffix);
  const projectId = `proj_project_guardrails_consolidate_${suffix}`;
  const canonicalRuleId = `pol_project_allowed_alpha_${suffix}`;
  const duplicateRuleId = `pol_project_allowed_zulu_${suffix}`;
  const unrelatedRuleId = `pol_project_deny_model_${suffix}`;

  try {
    await insertProject(connection.db, {
      workspaceId,
      projectId,
    });
    await insertPolicyRule(connection.db, {
      id: canonicalRuleId,
      workspaceId,
      projectId,
      name: "Alpha legacy allow providers",
      ruleType: "allow_provider",
      enforcementMode: "hard_block",
      conditionsJson: {
        providers: ["anthropic"],
      },
      createdAt: new Date("2026-03-25T09:00:00.000Z"),
    });
    await insertPolicyRule(connection.db, {
      id: duplicateRuleId,
      workspaceId,
      projectId,
      name: "Zulu legacy allow providers",
      ruleType: "allow_provider",
      enforcementMode: "soft_warn",
      conditionsJson: {
        providers: ["openai"],
      },
      createdAt: new Date("2026-03-25T10:00:00.000Z"),
    });
    await insertPolicyRule(connection.db, {
      id: unrelatedRuleId,
      workspaceId,
      projectId,
      name: "Deny premium model",
      ruleType: "deny_model",
      enforcementMode: "hard_block",
      conditionsJson: {
        models: ["gpt-5.2"],
      },
      createdAt: new Date("2026-03-25T11:00:00.000Z"),
    });

    const summary = await upsertProjectAllowedProviders(
      {
        workspaceId,
        projectId,
        providers: ["anthropic", "openai"],
      },
      connection.db,
    );
    const storedAllowRules = await listProjectPolicyRules(connection.db, {
      workspaceId,
      projectId,
      ruleType: "allow_provider",
    });
    const unrelatedRule = await connection.db.query.policyRules.findFirst({
      where: (table, { and, eq }) =>
        and(eq(table.workspaceId, workspaceId), eq(table.id, unrelatedRuleId)),
    });
    const auditLog = await listProjectAuditEvents(connection.db, {
      workspaceId,
      projectId,
    });

    assert.equal(summary.policyRuleId, canonicalRuleId);
    assert.deepEqual(summary.providers, ["openai", "anthropic"]);
    assert.equal(
      storedAllowRules.filter((rule) => rule.status === "active").length,
      1,
    );
    assert.equal(storedAllowRules[0]?.name, "Project allowed providers");
    assert.equal(storedAllowRules[0]?.status, "active");
    assert.equal(storedAllowRules[0]?.enforcementMode, "hard_block");
    assert.deepEqual(storedAllowRules[0]?.conditionsJson, {
      version: 1,
      providers: ["openai", "anthropic"],
    });
    assert.equal(storedAllowRules[1]?.status, "inactive");
    assert.equal(unrelatedRule?.status, "active");
    assert.equal(auditLog.length, 1);
    assert.deepEqual(auditLog[0]?.eventPayload, {
      message: "Set the project allowed providers to openai, anthropic.",
      providers: ["openai", "anthropic"],
      previous_providers: ["anthropic"],
      policy_rule_id: canonicalRuleId,
      deactivated_policy_rule_ids: [duplicateRuleId],
    });
  } finally {
    await cleanupWorkspace(connection.db, workspaceId);
  }
});

test("getProjectGuardrailsForAdmin composes workspace budget cap, project guardrails, and unmanaged policy warnings", async (t) => {
  const connection = await openIntegrationDatabase(t);

  if (!connection) {
    return;
  }

  const suffix = randomUUID().slice(0, 8);
  const workspaceId = await insertWorkspace(connection.db, suffix);
  const projectId = `proj_project_guardrails_read_${suffix}`;

  try {
    await insertProject(connection.db, {
      workspaceId,
      projectId,
    });
    await upsertWorkspaceBudgetCap(
      {
        workspaceId,
        limitUsd: 150,
      },
      connection.db,
    );
    const preferredSummary = await upsertProjectPreferredProvider(
      {
        workspaceId,
        projectId,
        provider: "anthropic",
      },
      connection.db,
    );
    const allowedSummary = await upsertProjectAllowedProviders(
      {
        workspaceId,
        projectId,
        providers: ["openai"],
      },
      connection.db,
    );

    await insertPolicyRule(connection.db, {
      id: `pol_workspace_allow_model_${suffix}`,
      workspaceId,
      name: "Workspace allow model",
      ruleType: "allow_model",
      enforcementMode: "hard_block",
      conditionsJson: {
        models: ["gpt-5-mini"],
      },
    });
    await insertPolicyRule(connection.db, {
      id: `pol_workspace_soft_budget_${suffix}`,
      workspaceId,
      name: "Workspace soft budget",
      ruleType: "budget_cap",
      enforcementMode: "soft_warn",
      conditionsJson: {
        limitUsd: 300,
      },
    });
    await insertPolicyRule(connection.db, {
      id: `pol_project_budget_${suffix}`,
      workspaceId,
      projectId,
      name: "Project budget cap",
      ruleType: "budget_cap",
      enforcementMode: "hard_block",
      conditionsJson: {
        limitUsd: 50,
      },
    });
    await insertPolicyRule(connection.db, {
      id: `pol_project_mode_mapping_${suffix}`,
      workspaceId,
      projectId,
      name: "Project mode mapping",
      ruleType: "mode_model_mapping",
      enforcementMode: "hard_block",
      conditionsJson: {
        mode: "balanced",
        modelId: "gpt-5-mini",
      },
    });
    await insertPolicyRule(connection.db, {
      id: `pol_project_soft_allow_provider_${suffix}`,
      workspaceId,
      projectId,
      name: "Project soft allow provider",
      ruleType: "allow_provider",
      enforcementMode: "soft_warn",
      conditionsJson: {
        providers: ["anthropic"],
      },
    });

    const summary = await getProjectGuardrailsForAdmin(
      {
        workspaceId,
        projectId,
      },
      connection.db,
    );

    assert.equal(summary.workspaceBudgetCap.enabled, true);
    assert.equal(summary.workspaceBudgetCap.limitUsd, 150);
    assert.deepEqual(summary.preferredProvider, preferredSummary);
    assert.deepEqual(summary.allowedProviders, allowedSummary);
    assert.deepEqual(summary.unmanagedPolicyWarnings, {
      workspace: {
        count: 2,
        ruleTypes: ["allow_model", "budget_cap"],
      },
      project: {
        count: 3,
        ruleTypes: ["allow_provider", "budget_cap", "mode_model_mapping"],
      },
    });
  } finally {
    await cleanupWorkspace(connection.db, workspaceId);
  }
});

test("project guardrail services surface typed errors for missing resources and invalid provider values", async (t) => {
  const connection = await openIntegrationDatabase(t);

  if (!connection) {
    return;
  }

  const suffix = randomUUID().slice(0, 8);
  const workspaceId = await insertWorkspace(connection.db, suffix);
  const projectId = `proj_project_guardrails_errors_${suffix}`;

  try {
    await insertProject(connection.db, {
      workspaceId,
      projectId,
    });

    await assert.rejects(
      upsertProjectPreferredProvider(
        {
          workspaceId: `ws_missing_${suffix}`,
          projectId,
          provider: "openai",
        },
        connection.db,
      ),
      (error: unknown) =>
        error instanceof ProjectGuardrailsServiceError &&
        error.code === "workspace_not_found",
    );
    await assert.rejects(
      upsertProjectPreferredProvider(
        {
          workspaceId,
          projectId: `proj_missing_${suffix}`,
          provider: "openai",
        },
        connection.db,
      ),
      (error: unknown) =>
        error instanceof ProjectGuardrailsServiceError &&
        error.code === "project_not_found",
    );
    await assert.rejects(
      upsertProjectPreferredProvider(
        {
          workspaceId,
          projectId,
          provider: "google" as never,
        },
        connection.db,
      ),
      (error: unknown) =>
        error instanceof ProjectGuardrailsServiceError &&
        error.code === "invalid_preferred_provider",
    );
    await assert.rejects(
      upsertProjectAllowedProviders(
        {
          workspaceId,
          projectId,
          providers: ["openai", "google" as never],
        },
        connection.db,
      ),
      (error: unknown) =>
        error instanceof ProjectGuardrailsServiceError &&
        error.code === "invalid_allowed_provider",
    );
  } finally {
    await cleanupWorkspace(connection.db, workspaceId);
  }
});
