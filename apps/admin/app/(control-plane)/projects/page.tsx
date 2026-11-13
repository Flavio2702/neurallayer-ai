import {
  listProjects,
  type ProjectSummary,
  resolveDefaultAdminWorkspace,
} from "@neuralayer/db";
import Link from "next/link";

import { ControlPlanePanel } from "@/components/control-plane-panel";
import { StatusBadge } from "@/components/status-badge";
import { formatDateTime } from "@/lib/format";

import { createProjectFromAdmin } from "./actions";

interface ProjectsPageProps {
  searchParams?: Promise<{
    error?: string;
  }>;
}

type ProjectsSnapshot =
  | {
      available: false;
      errorMessage: string;
    }
  | {
      available: true;
      workspaceContext: NonNullable<
        Awaited<ReturnType<typeof resolveDefaultAdminWorkspace>>
      >;
      projects: ProjectSummary[];
    };

async function loadProjectsSnapshot(): Promise<ProjectsSnapshot> {
  try {
    const workspaceContext = await resolveDefaultAdminWorkspace();

    if (!workspaceContext) {
      return {
        available: false,
        errorMessage:
          "No active workspace is available in the configured database.",
      };
    }

    return {
      available: true,
      workspaceContext,
      projects: await listProjects(workspaceContext.workspace.id),
    };
  } catch (error) {
    return {
      available: false,
      errorMessage:
        error instanceof Error
          ? error.message
          : "The Projects page could not load database-backed state.",
    };
  }
}

function getNoticeClasses(tone: "danger") {
  return tone === "danger" ? "border-rose-200 bg-rose-50 text-rose-700" : "";
}

function getProjectStatusTone(status: ProjectSummary["status"]) {
  return status === "active" ? "success" : "warning";
}

function getProjectDetailPath(slug: string) {
  return `/projects/${encodeURIComponent(slug)}`;
}

export default async function ProjectsPage({
  searchParams,
}: ProjectsPageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const snapshot = await loadProjectsSnapshot();

  if (!snapshot.available) {
    return (
      <ControlPlanePanel
        title="Database state unavailable"
        description="Projects stays server-rendered and DB-backed; there is no fake local-only project list or create flow."
      >
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-5 text-sm leading-6 text-rose-700">
          {snapshot.errorMessage}
        </div>
      </ControlPlanePanel>
    );
  }

  return (
    <div className="grid gap-6">
      {resolvedSearchParams?.error ? (
        <div
          className={`rounded-2xl border px-4 py-4 text-sm ${getNoticeClasses("danger")}`}
        >
          {resolvedSearchParams.error}
        </div>
      ) : null}

      <ControlPlanePanel
        title="Create project"
        description="Create the next active project and land directly on its setup page. Sprint 2 keeps this flow narrow: start with name, then manage the basics, project keys, and provider guardrails from detail."
      >
        <div className="grid gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
          <article className="rounded-2xl border border-[hsl(var(--border))] bg-card p-4 text-sm text-[hsl(var(--muted))]">
            <p className="font-semibold text-[hsl(var(--foreground))]">
              Current workspace context
            </p>
            <p className="mt-3 text-base font-semibold text-[hsl(var(--foreground))]">
              {snapshot.workspaceContext.workspace.name}
            </p>
            <p className="mt-2">
              Default mode: {snapshot.workspaceContext.workspace.defaultMode}
            </p>
            <p className="mt-2">
              Current active project:{" "}
              {snapshot.workspaceContext.project?.name ?? "No active project"}
            </p>
            <p className="mt-3">
              New projects start as{" "}
              <span className="font-semibold text-[hsl(var(--foreground))]">
                active
              </span>
              . The DB service derives the first project link automatically,
              then the detail page takes over for rename, slug, status, and
              project key generation.
            </p>
          </article>

          <form
            action={createProjectFromAdmin}
            className="rounded-2xl border border-[hsl(var(--border))] bg-card p-4"
          >
            <input
              type="hidden"
              name="workspaceId"
              value={snapshot.workspaceContext.workspace.id}
            />

            <div className="space-y-2">
              <label
                htmlFor="project-name"
                className="text-sm font-semibold text-[hsl(var(--foreground))]"
              >
                Project name
              </label>
              <input
                id="project-name"
                name="name"
                type="text"
                placeholder="Design partner production"
                className="w-full rounded-2xl border border-[hsl(var(--border))] bg-card px-4 py-3 text-sm text-[hsl(var(--foreground))]"
              />
              <p className="text-sm leading-6 text-[hsl(var(--muted))]">
                Use the name your team will recognize in daily work. The project
                detail page will open right after create so you can tighten the
                basics there.
              </p>
            </div>

            <button
              type="submit"
              className="mt-4 inline-flex items-center rounded-full border border-[hsl(var(--primary))] bg-[hsl(var(--primary))] px-4 py-2 text-sm font-semibold text-white"
            >
              Create active project
            </button>
          </form>
        </div>
      </ControlPlanePanel>

      <ControlPlanePanel
        title="Projects"
        description="This list reads real workspace projects from the DB. Open a project to manage the basics, project keys, and the two narrow provider guardrails used in Sprint 2."
      >
        <div className="space-y-3">
          {snapshot.projects.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[hsl(var(--border))] px-4 py-5 text-sm text-[hsl(var(--muted))]">
              No projects exist for this workspace yet. Create the first active
              project above to continue the Sprint 2 self-serve journey.
            </div>
          ) : (
            snapshot.projects.map((project) => (
              <article
                key={project.id}
                className="rounded-2xl border border-[hsl(var(--border))] bg-card p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-[hsl(var(--foreground))]">
                      {project.name}
                    </p>
                    <p className="mt-1 font-mono text-xs text-[hsl(var(--muted))]">
                      {project.slug}
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {snapshot.workspaceContext.project?.id === project.id ? (
                      <StatusBadge tone="info">
                        current admin project
                      </StatusBadge>
                    ) : null}
                    <StatusBadge tone={getProjectStatusTone(project.status)}>
                      {project.status}
                    </StatusBadge>
                  </div>
                </div>

                <div className="mt-4 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card-muted))] p-3 text-sm text-[hsl(var(--muted))]">
                  <p>Created: {formatDateTime(project.createdAt)}</p>
                  <p className="mt-1">
                    Updated: {formatDateTime(project.updatedAt)}
                  </p>
                </div>

                <div className="mt-4 flex justify-end">
                  <Link
                    href={getProjectDetailPath(project.slug)}
                    className="inline-flex items-center rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--card-muted))] px-4 py-2 text-sm font-semibold text-[hsl(var(--foreground))] transition-colors hover:border-[hsl(var(--foreground))]"
                  >
                    Open project
                  </Link>
                </div>
              </article>
            ))
          )}
        </div>
      </ControlPlanePanel>
    </div>
  );
}
