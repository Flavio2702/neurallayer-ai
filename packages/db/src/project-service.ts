import { randomUUID } from "node:crypto";

import { and, asc, eq, ne } from "drizzle-orm";

import type { Database } from "./client";
import { withDatabase } from "./connection-helpers";
import { auditEvents, projects, workspaces } from "./schema";

type DatabaseTransaction = Parameters<
  Parameters<Database["transaction"]>[0]
>[0];
type ProjectServiceDatabase = Database | DatabaseTransaction;

const DEFAULT_PROJECT_SLUG = "project";
const SLUG_SEPARATOR_PATTERN = /[^a-zA-Z0-9]+/g;
const SLUG_EDGE_PATTERN = /^-+|-+$/g;
const SLUG_REPEAT_PATTERN = /-+/g;
const DIACRITIC_PATTERN = /[\u0300-\u036f]/g;

export type ProjectSummary = {
  id: string;
  workspaceId: string;
  name: string;
  slug: string;
  status: (typeof projects.$inferSelect)["status"];
  createdAt: string;
  updatedAt: string;
};

export type ProjectLifecycleErrorCode =
  | "workspace_not_found"
  | "project_not_found"
  | "invalid_project_name"
  | "invalid_project_slug"
  | "project_slug_conflict";

export class ProjectLifecycleError extends Error {
  readonly code: ProjectLifecycleErrorCode;

  constructor(code: ProjectLifecycleErrorCode, message: string) {
    super(message);
    this.name = "ProjectLifecycleError";
    this.code = code;
  }
}

function createProjectLifecycleError(code: ProjectLifecycleErrorCode) {
  switch (code) {
    case "workspace_not_found":
      return new ProjectLifecycleError(
        code,
        "The requested workspace does not exist.",
      );
    case "project_not_found":
      return new ProjectLifecycleError(
        code,
        "The requested project does not exist in this workspace.",
      );
    case "invalid_project_name":
      return new ProjectLifecycleError(code, "Project name is required.");
    case "invalid_project_slug":
      return new ProjectLifecycleError(
        code,
        "Project slug must contain at least one letter or number.",
      );
    case "project_slug_conflict":
      return new ProjectLifecycleError(
        code,
        "Another project in this workspace already uses that slug.",
      );
    default:
      return new ProjectLifecycleError(
        "project_not_found",
        "The requested project does not exist in this workspace.",
      );
  }
}

function toProjectSummary(row: typeof projects.$inferSelect): ProjectSummary {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    slug: row.slug,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function sanitizeProjectName(name: string) {
  const normalizedName = name.trim();

  if (normalizedName.length === 0) {
    throw createProjectLifecycleError("invalid_project_name");
  }

  return normalizedName;
}

function slugifyProjectValue(value: string) {
  return value
    .normalize("NFKD")
    .replace(DIACRITIC_PATTERN, "")
    .toLowerCase()
    .replace(SLUG_SEPARATOR_PATTERN, "-")
    .replace(SLUG_REPEAT_PATTERN, "-")
    .replace(SLUG_EDGE_PATTERN, "");
}

function normalizeProjectSlug(
  slug: string,
  input: {
    fallback?: string;
    strict?: boolean;
  } = {},
) {
  const normalizedSlug = slugifyProjectValue(slug.trim());

  if (normalizedSlug.length > 0) {
    return normalizedSlug;
  }

  if (input.strict) {
    throw createProjectLifecycleError("invalid_project_slug");
  }

  return input.fallback ?? DEFAULT_PROJECT_SLUG;
}

async function requireWorkspaceExists(
  db: ProjectServiceDatabase,
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
    throw createProjectLifecycleError("workspace_not_found");
  }
}

async function requireProjectRow(
  db: ProjectServiceDatabase,
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
    throw createProjectLifecycleError("project_not_found");
  }

  return project;
}

async function requireProjectRowBySlug(
  db: ProjectServiceDatabase,
  input: {
    workspaceId: string;
    slug: string;
  },
) {
  const [project] = await db
    .select()
    .from(projects)
    .where(
      and(
        eq(projects.workspaceId, input.workspaceId),
        eq(projects.slug, input.slug),
      ),
    )
    .limit(1);

  if (!project) {
    throw createProjectLifecycleError("project_not_found");
  }

  return project;
}

async function resolveUniqueProjectSlug(
  db: ProjectServiceDatabase,
  input: {
    workspaceId: string;
    slugBase: string;
  },
) {
  let candidateSlug = input.slugBase;
  let suffix = 2;

  while (true) {
    const [existingProject] = await db
      .select({
        id: projects.id,
      })
      .from(projects)
      .where(
        and(
          eq(projects.workspaceId, input.workspaceId),
          eq(projects.slug, candidateSlug),
        ),
      )
      .limit(1);

    if (!existingProject) {
      return candidateSlug;
    }

    candidateSlug = `${input.slugBase}-${suffix}`;
    suffix += 1;
  }
}

async function insertProjectAuditEvent(
  db: ProjectServiceDatabase,
  input: {
    workspaceId: string;
    projectId: string;
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
    entityType: "project",
    entityId: input.projectId,
    eventPayload: input.eventPayload,
    createdAt: input.createdAt,
  });
}

async function ensureProjectSlugAvailable(
  db: ProjectServiceDatabase,
  input: {
    workspaceId: string;
    projectId: string;
    slug: string;
  },
) {
  const [existingProject] = await db
    .select({
      id: projects.id,
    })
    .from(projects)
    .where(
      and(
        eq(projects.workspaceId, input.workspaceId),
        eq(projects.slug, input.slug),
        ne(projects.id, input.projectId),
      ),
    )
    .limit(1);

  if (existingProject) {
    throw createProjectLifecycleError("project_slug_conflict");
  }
}

async function updateProjectStatus(
  input: {
    workspaceId: string;
    projectId: string;
    status: (typeof projects.$inferSelect)["status"];
  },
  database?: Database,
) {
  return withDatabase(database, async (db) => {
    await requireWorkspaceExists(db, input.workspaceId);

    return db.transaction(async (tx) => {
      const project = await requireProjectRow(tx, input);

      if (project.status === input.status) {
        return toProjectSummary(project);
      }

      const now = new Date();
      const [updatedProject] = await tx
        .update(projects)
        .set({
          status: input.status,
          updatedAt: now,
        })
        .where(
          and(
            eq(projects.workspaceId, input.workspaceId),
            eq(projects.id, input.projectId),
          ),
        )
        .returning();

      if (!updatedProject) {
        throw createProjectLifecycleError("project_not_found");
      }

      const eventType =
        input.status === "active" ? "project.activated" : "project.deactivated";
      const message =
        input.status === "active"
          ? `Activated project ${updatedProject.name}.`
          : `Deactivated project ${updatedProject.name}.`;

      await insertProjectAuditEvent(tx, {
        workspaceId: input.workspaceId,
        projectId: updatedProject.id,
        eventType,
        eventPayload: {
          message,
          name: updatedProject.name,
          slug: updatedProject.slug,
          status: updatedProject.status,
        },
        createdAt: now,
      });

      return toProjectSummary(updatedProject);
    });
  });
}

export async function listProjects(
  workspaceId: string,
  database?: Database,
): Promise<ProjectSummary[]> {
  return withDatabase(database, async (db) => {
    await requireWorkspaceExists(db, workspaceId);

    const rows = await db
      .select()
      .from(projects)
      .where(eq(projects.workspaceId, workspaceId))
      .orderBy(asc(projects.status), asc(projects.name), asc(projects.id));

    return rows.map(toProjectSummary);
  });
}

export async function getProjectBySlug(
  input: {
    workspaceId: string;
    slug: string;
  },
  database?: Database,
): Promise<ProjectSummary> {
  return withDatabase(database, async (db) => {
    await requireWorkspaceExists(db, input.workspaceId);

    const slug = normalizeProjectSlug(input.slug, {
      strict: true,
    });
    const project = await requireProjectRowBySlug(db, {
      workspaceId: input.workspaceId,
      slug,
    });

    return toProjectSummary(project);
  });
}

export async function createProject(
  input: {
    workspaceId: string;
    name: string;
    slug?: string;
  },
  database?: Database,
): Promise<ProjectSummary> {
  return withDatabase(database, async (db) => {
    await requireWorkspaceExists(db, input.workspaceId);

    const name = sanitizeProjectName(input.name);
    const slugBase = normalizeProjectSlug(input.slug ?? name);

    return db.transaction(async (tx) => {
      const now = new Date();
      const slug = await resolveUniqueProjectSlug(tx, {
        workspaceId: input.workspaceId,
        slugBase,
      });
      const [project] = await tx
        .insert(projects)
        .values({
          id: randomUUID(),
          workspaceId: input.workspaceId,
          name,
          slug,
          status: "active",
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      if (!project) {
        throw createProjectLifecycleError("project_not_found");
      }

      await insertProjectAuditEvent(tx, {
        workspaceId: input.workspaceId,
        projectId: project.id,
        eventType: "project.created",
        eventPayload: {
          message: `Created project ${project.name}.`,
          name: project.name,
          slug: project.slug,
          status: project.status,
        },
        createdAt: now,
      });

      return toProjectSummary(project);
    });
  });
}

export async function renameProject(
  input: {
    workspaceId: string;
    projectId: string;
    name: string;
  },
  database?: Database,
): Promise<ProjectSummary> {
  return withDatabase(database, async (db) => {
    await requireWorkspaceExists(db, input.workspaceId);

    const name = sanitizeProjectName(input.name);

    return db.transaction(async (tx) => {
      const project = await requireProjectRow(tx, input);

      if (project.name === name) {
        return toProjectSummary(project);
      }

      const now = new Date();
      const [updatedProject] = await tx
        .update(projects)
        .set({
          name,
          updatedAt: now,
        })
        .where(
          and(
            eq(projects.workspaceId, input.workspaceId),
            eq(projects.id, input.projectId),
          ),
        )
        .returning();

      if (!updatedProject) {
        throw createProjectLifecycleError("project_not_found");
      }

      await insertProjectAuditEvent(tx, {
        workspaceId: input.workspaceId,
        projectId: updatedProject.id,
        eventType: "project.renamed",
        eventPayload: {
          message: `Renamed project ${project.name} to ${updatedProject.name}.`,
          name: updatedProject.name,
          slug: updatedProject.slug,
          status: updatedProject.status,
          previous_name: project.name,
        },
        createdAt: now,
      });

      return toProjectSummary(updatedProject);
    });
  });
}

export async function updateProjectSlug(
  input: {
    workspaceId: string;
    projectId: string;
    slug: string;
  },
  database?: Database,
): Promise<ProjectSummary> {
  return withDatabase(database, async (db) => {
    await requireWorkspaceExists(db, input.workspaceId);

    const slug = normalizeProjectSlug(input.slug, {
      strict: true,
    });

    return db.transaction(async (tx) => {
      const project = await requireProjectRow(tx, input);

      if (project.slug === slug) {
        return toProjectSummary(project);
      }

      await ensureProjectSlugAvailable(tx, {
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        slug,
      });

      const now = new Date();
      const [updatedProject] = await tx
        .update(projects)
        .set({
          slug,
          updatedAt: now,
        })
        .where(
          and(
            eq(projects.workspaceId, input.workspaceId),
            eq(projects.id, input.projectId),
          ),
        )
        .returning();

      if (!updatedProject) {
        throw createProjectLifecycleError("project_not_found");
      }

      await insertProjectAuditEvent(tx, {
        workspaceId: input.workspaceId,
        projectId: updatedProject.id,
        eventType: "project.slug_updated",
        eventPayload: {
          message: `Updated project slug from ${project.slug} to ${updatedProject.slug}.`,
          name: updatedProject.name,
          slug: updatedProject.slug,
          status: updatedProject.status,
          previous_slug: project.slug,
        },
        createdAt: now,
      });

      return toProjectSummary(updatedProject);
    });
  });
}

export async function activateProject(
  input: {
    workspaceId: string;
    projectId: string;
  },
  database?: Database,
): Promise<ProjectSummary> {
  return updateProjectStatus(
    {
      ...input,
      status: "active",
    },
    database,
  );
}

export async function deactivateProject(
  input: {
    workspaceId: string;
    projectId: string;
  },
  database?: Database,
): Promise<ProjectSummary> {
  return updateProjectStatus(
    {
      ...input,
      status: "inactive",
    },
    database,
  );
}
