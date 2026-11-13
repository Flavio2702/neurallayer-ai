import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { type TestContext, test } from "node:test";

import { loadDatabaseConfig } from "@neuralayer/config";
import { asc, eq } from "drizzle-orm";
import { createDbConnection, type Database } from "./client";
import {
  activateProject,
  createProject,
  deactivateProject,
  getProjectBySlug,
  listProjects,
  ProjectLifecycleError,
  renameProject,
  updateProjectSlug,
} from "./project-service";
import { auditEvents, projects, workspaces } from "./schema";

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
  const workspaceId = `ws_project_service_${suffix}`;

  await database.insert(workspaces).values({
    id: workspaceId,
    name: `Project Service ${suffix}`,
    slug: `project-service-${suffix}`,
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
    name: string;
    slug: string;
    status?: "active" | "inactive";
  },
) {
  await database.insert(projects).values({
    id: input.projectId,
    workspaceId: input.workspaceId,
    name: input.name,
    slug: input.slug,
    status: input.status ?? "active",
  });
}

async function cleanupWorkspace(database: Database, workspaceId: string) {
  await database
    .delete(auditEvents)
    .where(eq(auditEvents.workspaceId, workspaceId));
  await database.delete(projects).where(eq(projects.workspaceId, workspaceId));
  await database.delete(workspaces).where(eq(workspaces.id, workspaceId));
}

test("listProjects returns workspace-scoped projects ordered by status, name, and id", async (t) => {
  const connection = await openIntegrationDatabase(t);

  if (!connection) {
    return;
  }

  const suffix = randomUUID().slice(0, 8);
  const workspaceId = await insertWorkspace(connection.db, suffix);
  const otherWorkspaceId = await insertWorkspace(
    connection.db,
    `${suffix}_other`,
  );

  try {
    await insertProject(connection.db, {
      workspaceId,
      projectId: `proj_${suffix}_zeta`,
      name: "Zeta Project",
      slug: "zeta-project",
      status: "active",
    });
    await insertProject(connection.db, {
      workspaceId,
      projectId: `proj_${suffix}_alpha`,
      name: "Alpha Project",
      slug: "alpha-project",
      status: "active",
    });
    await insertProject(connection.db, {
      workspaceId,
      projectId: `proj_${suffix}_inactive`,
      name: "Beta Project",
      slug: "beta-project",
      status: "inactive",
    });
    await insertProject(connection.db, {
      workspaceId: otherWorkspaceId,
      projectId: `proj_${suffix}_other`,
      name: "Other Workspace Project",
      slug: "other-workspace-project",
      status: "active",
    });

    const summaries = await listProjects(workspaceId, connection.db);

    assert.deepEqual(
      summaries.map((summary) => [summary.status, summary.name, summary.slug]),
      [
        ["active", "Alpha Project", "alpha-project"],
        ["active", "Zeta Project", "zeta-project"],
        ["inactive", "Beta Project", "beta-project"],
      ],
    );
  } finally {
    await cleanupWorkspace(connection.db, otherWorkspaceId);
    await cleanupWorkspace(connection.db, workspaceId);
  }
});

test("createProject derives unique slugs, including explicit slug conflicts, and writes audit events", async (t) => {
  const connection = await openIntegrationDatabase(t);

  if (!connection) {
    return;
  }

  const suffix = randomUUID().slice(0, 8);
  const workspaceId = await insertWorkspace(connection.db, suffix);

  try {
    await insertProject(connection.db, {
      workspaceId,
      projectId: `proj_${suffix}_existing`,
      name: "Alpha Team",
      slug: "alpha-team",
    });

    const createdFromName = await createProject(
      {
        workspaceId,
        name: "Alpha Team",
      },
      connection.db,
    );
    const createdFromExplicitSlug = await createProject(
      {
        workspaceId,
        name: "Gamma Team",
        slug: "Alpha Team",
      },
      connection.db,
    );
    const createdAuditEvents = await connection.db.query.auditEvents.findMany({
      where: (table, { and, eq }) =>
        and(
          eq(table.workspaceId, workspaceId),
          eq(table.entityType, "project"),
          eq(table.eventType, "project.created"),
        ),
      orderBy: (table, { asc }) => [asc(table.createdAt), asc(table.id)],
    });

    assert.equal(createdFromName.slug, "alpha-team-2");
    assert.equal(createdFromName.status, "active");
    assert.equal(createdFromExplicitSlug.slug, "alpha-team-3");
    assert.equal(createdAuditEvents.length, 2);
    assert.deepEqual(createdAuditEvents[0]?.eventPayload, {
      message: `Created project ${createdFromName.name}.`,
      name: createdFromName.name,
      slug: createdFromName.slug,
      status: createdFromName.status,
    });
    assert.deepEqual(createdAuditEvents[1]?.eventPayload, {
      message: `Created project ${createdFromExplicitSlug.name}.`,
      name: createdFromExplicitSlug.name,
      slug: createdFromExplicitSlug.slug,
      status: createdFromExplicitSlug.status,
    });
  } finally {
    await cleanupWorkspace(connection.db, workspaceId);
  }
});

test("getProjectBySlug resolves the workspace-scoped project summary and normalizes slug input", async (t) => {
  const connection = await openIntegrationDatabase(t);

  if (!connection) {
    return;
  }

  const suffix = randomUUID().slice(0, 8);
  const workspaceId = await insertWorkspace(connection.db, suffix);
  const otherWorkspaceId = await insertWorkspace(
    connection.db,
    `${suffix}_other`,
  );
  const projectId = `proj_${suffix}_slug_lookup`;

  try {
    await insertProject(connection.db, {
      workspaceId,
      projectId,
      name: "Launch Pad",
      slug: "launch-pad",
    });
    await insertProject(connection.db, {
      workspaceId: otherWorkspaceId,
      projectId: `proj_${suffix}_other_workspace`,
      name: "Other Launch Pad",
      slug: "launch-pad",
    });

    const project = await getProjectBySlug(
      {
        workspaceId,
        slug: " Launch Pad ",
      },
      connection.db,
    );

    assert.equal(project.id, projectId);
    assert.equal(project.workspaceId, workspaceId);
    assert.equal(project.name, "Launch Pad");
    assert.equal(project.slug, "launch-pad");
  } finally {
    await cleanupWorkspace(connection.db, otherWorkspaceId);
    await cleanupWorkspace(connection.db, workspaceId);
  }
});

test("renameProject and updateProjectSlug change only the intended fields and audit real mutations", async (t) => {
  const connection = await openIntegrationDatabase(t);

  if (!connection) {
    return;
  }

  const suffix = randomUUID().slice(0, 8);
  const workspaceId = await insertWorkspace(connection.db, suffix);
  const projectId = `proj_${suffix}_primary`;
  const otherProjectId = `proj_${suffix}_other`;

  try {
    await insertProject(connection.db, {
      workspaceId,
      projectId,
      name: "Initial Project",
      slug: "initial-project",
    });
    await insertProject(connection.db, {
      workspaceId,
      projectId: otherProjectId,
      name: "Other Project",
      slug: "other-project",
    });

    const renamedProject = await renameProject(
      {
        workspaceId,
        projectId,
        name: "  Renamed Project  ",
      },
      connection.db,
    );
    const slugUpdatedProject = await updateProjectSlug(
      {
        workspaceId,
        projectId,
        slug: " Launch Pad 2026!! ",
      },
      connection.db,
    );

    await renameProject(
      {
        workspaceId,
        projectId,
        name: "Renamed Project",
      },
      connection.db,
    );
    await updateProjectSlug(
      {
        workspaceId,
        projectId,
        slug: "launch-pad-2026",
      },
      connection.db,
    );

    await assert.rejects(
      updateProjectSlug(
        {
          workspaceId,
          projectId,
          slug: "other-project",
        },
        connection.db,
      ),
      (error: unknown) =>
        error instanceof ProjectLifecycleError &&
        error.code === "project_slug_conflict",
    );
    await assert.rejects(
      updateProjectSlug(
        {
          workspaceId,
          projectId,
          slug: "!!!",
        },
        connection.db,
      ),
      (error: unknown) =>
        error instanceof ProjectLifecycleError &&
        error.code === "invalid_project_slug",
    );

    const renamedAuditEvents = await connection.db.query.auditEvents.findMany({
      where: (table, { and, eq }) =>
        and(
          eq(table.workspaceId, workspaceId),
          eq(table.projectId, projectId),
          eq(table.entityType, "project"),
        ),
      orderBy: (table, { asc }) => [asc(table.createdAt), asc(table.id)],
    });

    assert.equal(renamedProject.name, "Renamed Project");
    assert.equal(renamedProject.slug, "initial-project");
    assert.equal(slugUpdatedProject.slug, "launch-pad-2026");
    assert.equal(renamedAuditEvents.length, 2);
    assert.equal(renamedAuditEvents[0]?.eventType, "project.renamed");
    assert.deepEqual(renamedAuditEvents[0]?.eventPayload, {
      message: "Renamed project Initial Project to Renamed Project.",
      name: "Renamed Project",
      slug: "initial-project",
      status: "active",
      previous_name: "Initial Project",
    });
    assert.equal(renamedAuditEvents[1]?.eventType, "project.slug_updated");
    assert.deepEqual(renamedAuditEvents[1]?.eventPayload, {
      message: "Updated project slug from initial-project to launch-pad-2026.",
      name: "Renamed Project",
      slug: "launch-pad-2026",
      status: "active",
      previous_slug: "initial-project",
    });
  } finally {
    await cleanupWorkspace(connection.db, workspaceId);
  }
});

test("activateProject and deactivateProject are idempotent and audit only real status transitions", async (t) => {
  const connection = await openIntegrationDatabase(t);

  if (!connection) {
    return;
  }

  const suffix = randomUUID().slice(0, 8);
  const workspaceId = await insertWorkspace(connection.db, suffix);
  const projectId = `proj_${suffix}_status`;

  try {
    await insertProject(connection.db, {
      workspaceId,
      projectId,
      name: "Status Project",
      slug: "status-project",
    });

    const deactivatedProject = await deactivateProject(
      {
        workspaceId,
        projectId,
      },
      connection.db,
    );
    const deactivatedAgain = await deactivateProject(
      {
        workspaceId,
        projectId,
      },
      connection.db,
    );
    const activatedProject = await activateProject(
      {
        workspaceId,
        projectId,
      },
      connection.db,
    );
    const activatedAgain = await activateProject(
      {
        workspaceId,
        projectId,
      },
      connection.db,
    );
    const statusAuditEvents = await connection.db.query.auditEvents.findMany({
      where: (table, { and, eq }) =>
        and(
          eq(table.workspaceId, workspaceId),
          eq(table.projectId, projectId),
          eq(table.entityType, "project"),
        ),
      orderBy: (table, { asc }) => [asc(table.createdAt), asc(table.id)],
    });

    assert.equal(deactivatedProject.status, "inactive");
    assert.equal(deactivatedAgain.status, "inactive");
    assert.equal(activatedProject.status, "active");
    assert.equal(activatedAgain.status, "active");
    assert.deepEqual(
      statusAuditEvents.map((event) => event.eventType),
      ["project.deactivated", "project.activated"],
    );
    assert.deepEqual(statusAuditEvents[0]?.eventPayload, {
      message: "Deactivated project Status Project.",
      name: "Status Project",
      slug: "status-project",
      status: "inactive",
    });
    assert.deepEqual(statusAuditEvents[1]?.eventPayload, {
      message: "Activated project Status Project.",
      name: "Status Project",
      slug: "status-project",
      status: "active",
    });
  } finally {
    await cleanupWorkspace(connection.db, workspaceId);
  }
});

test("project lifecycle services surface typed errors for missing resources and invalid names", async (t) => {
  const connection = await openIntegrationDatabase(t);

  if (!connection) {
    return;
  }

  const suffix = randomUUID().slice(0, 8);
  const workspaceId = await insertWorkspace(connection.db, suffix);
  const projectId = `proj_${suffix}_errors`;

  try {
    await insertProject(connection.db, {
      workspaceId,
      projectId,
      name: "Error Project",
      slug: "error-project",
    });

    await assert.rejects(
      listProjects(`ws_missing_${suffix}`, connection.db),
      (error: unknown) =>
        error instanceof ProjectLifecycleError &&
        error.code === "workspace_not_found",
    );
    await assert.rejects(
      createProject(
        {
          workspaceId,
          name: "   ",
        },
        connection.db,
      ),
      (error: unknown) =>
        error instanceof ProjectLifecycleError &&
        error.code === "invalid_project_name",
    );
    await assert.rejects(
      renameProject(
        {
          workspaceId,
          projectId: `proj_missing_${suffix}`,
          name: "Renamed Missing Project",
        },
        connection.db,
      ),
      (error: unknown) =>
        error instanceof ProjectLifecycleError &&
        error.code === "project_not_found",
    );
    await assert.rejects(
      getProjectBySlug(
        {
          workspaceId,
          slug: "missing-project",
        },
        connection.db,
      ),
      (error: unknown) =>
        error instanceof ProjectLifecycleError &&
        error.code === "project_not_found",
    );
  } finally {
    await cleanupWorkspace(connection.db, workspaceId);
  }
});
