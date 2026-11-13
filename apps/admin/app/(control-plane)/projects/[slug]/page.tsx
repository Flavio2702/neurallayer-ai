import { loadAdminConfig } from "@neuralayer/config";

import { PROVIDER_NAME_VALUES, type ProviderName } from "@neuralayer/core";
import {
  getProjectBySlug,
  getProjectGuardrailsForAdmin,
  listProjectGatewayApiKeys,
  type ProjectGatewayApiKeySummary,
  type ProjectGuardrailsForAdmin,
  ProjectLifecycleError,
  type ProjectSummary,
  resolveDefaultAdminWorkspace,
} from "@neuralayer/db";
import Link from "next/link";
import { ControlPlanePanel } from "@/components/control-plane-panel";
import { ProjectApiKeyCreateForm } from "@/components/project-api-key-create-form";
import { StatusBadge } from "@/components/status-badge";
import { formatDateTime } from "@/lib/format";

import {
  activateProjectFromAdmin,
  deactivateProjectFromAdmin,
  renameProjectFromAdmin,
  revokeProjectGatewayApiKeyFromAdmin,
  updateProjectAllowedProvidersFromAdmin,
  updateProjectPreferredProviderFromAdmin,
  updateProjectSlugFromAdmin,
} from "../actions";

interface ProjectDetailPageProps {
  params: Promise<{
    slug: string;
  }>;
  searchParams?: Promise<{
    notice?: string;
    error?: string;
  }>;
}

type ProjectDetailSnapshot =
  | {
      available: false;
      errorMessage: string;
    }
  | {
      available: true;
      found: false;
      requestedSlug: string;
      workspaceContext: NonNullable<
        Awaited<ReturnType<typeof resolveDefaultAdminWorkspace>>
      >;
    }
  | {
      available: true;
      found: true;
      workspaceContext: NonNullable<
        Awaited<ReturnType<typeof resolveDefaultAdminWorkspace>>
      >;
      project: ProjectSummary;
      apiKeys: ProjectGatewayApiKeySummary[];
      guardrails: ProjectGuardrailsForAdmin;
    };

async function loadProjectDetailSnapshot(
  slug: string,
): Promise<ProjectDetailSnapshot> {
  try {
    const workspaceContext = await resolveDefaultAdminWorkspace();

    if (!workspaceContext) {
      return {
        available: false,
        errorMessage:
          "No active workspace is available in the configured database.",
      };
    }

    try {
      const project = await getProjectBySlug({
        workspaceId: workspaceContext.workspace.id,
        slug,
      });

      return {
        available: true,
        found: true,
        workspaceContext,
        project,
        ...(await (async () => {
          const [apiKeys, guardrails] = await Promise.all([
            listProjectGatewayApiKeys({
              workspaceId: workspaceContext.workspace.id,
              projectId: project.id,
            }),
            getProjectGuardrailsForAdmin({
              workspaceId: workspaceContext.workspace.id,
              projectId: project.id,
            }),
          ]);

          return {
            apiKeys,
            guardrails,
          };
        })()),
      };
    } catch (error) {
      if (
        error instanceof ProjectLifecycleError &&
        (error.code === "project_not_found" ||
          error.code === "invalid_project_slug")
      ) {
        return {
          available: true,
          found: false,
          requestedSlug: slug,
          workspaceContext,
        };
      }

      throw error;
    }
  } catch (error) {
    return {
      available: false,
      errorMessage:
        error instanceof Error
          ? error.message
          : "The project detail page could not load database-backed state.",
    };
  }
}

function getProjectStatusTone(status: ProjectSummary["status"]) {
  return status === "active" ? "success" : "warning";
}

function getGatewayApiKeyStatusTone(
  status: ProjectGatewayApiKeySummary["status"],
) {
  switch (status) {
    case "active":
      return "success";
    case "revoked":
      return "danger";
    default:
      return "warning";
  }
}

function getNoticeClasses(tone: "success" | "danger") {
  return tone === "success"
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : "border-rose-200 bg-rose-50 text-rose-700";
}

function getDetailNoticeState(input: { notice?: string; error?: string }) {
  switch (input.notice) {
    case "project_created":
      return {
        tone: "success",
        message:
          "Project created. Finish the basics here and generate the first project key when you're ready.",
      } as const;
    case "project_name_updated":
      return {
        tone: "success",
        message: "Project name saved.",
      } as const;
    case "project_slug_updated":
      return {
        tone: "success",
        message: "Project link saved.",
      } as const;
    case "project_activated":
      return {
        tone: "success",
        message: "Project activated and ready for routing again.",
      } as const;
    case "project_deactivated":
      return {
        tone: "success",
        message:
          "Project deactivated. New project-scoped keys and request routing now stay paused.",
      } as const;
    case "preferred_provider_saved":
      return {
        tone: "success",
        message:
          "Preferred provider saved. This project now leans toward that provider when more than one provider still fits the request.",
      } as const;
    case "preferred_provider_cleared":
      return {
        tone: "success",
        message:
          "Preferred provider cleared. This project no longer leans toward one provider over another.",
      } as const;
    case "allowed_providers_saved":
      return {
        tone: "success",
        message:
          "Allowed providers saved. This project can now route only through the providers you selected here.",
      } as const;
    case "allowed_providers_cleared":
      return {
        tone: "success",
        message:
          "Allowed providers cleared. This project can use any configured provider again.",
      } as const;
    case "api_key_revoked":
      return {
        tone: "success",
        message:
          "Project API key revoked. The raw value remains unavailable and the key can no longer authenticate requests.",
      } as const;
    default:
      return input.error
        ? ({
            tone: "danger",
            message: input.error,
          } as const)
        : null;
  }
}

function getStatusSummaryCopy(status: ProjectSummary["status"]) {
  return status === "active"
    ? "This project is currently available for project-scoped keys and request routing."
    : "This project is currently paused until you activate it again.";
}

function getStatusActionCopy(status: ProjectSummary["status"]) {
  return status === "active"
    ? "Pause this project when you want to stop new project traffic without deleting the record."
    : "Activate this project when you're ready to route traffic here again.";
}

function getProviderLabel(provider: ProviderName) {
  switch (provider) {
    case "openai":
      return "OpenAI";
    case "anthropic":
      return "Anthropic";
    default:
      return provider;
  }
}

function getProviderLabels(providers: ProviderName[]) {
  return providers.map((provider) => getProviderLabel(provider));
}

function getGuardrailStatusTone(enabled: boolean) {
  return enabled ? "success" : "neutral";
}

function getPreferredProviderSummary(guardrails: ProjectGuardrailsForAdmin) {
  if (!guardrails.preferredProvider.provider) {
    return "No preferred provider";
  }

  return getProviderLabel(guardrails.preferredProvider.provider);
}

function getAllowedProvidersSummary(guardrails: ProjectGuardrailsForAdmin) {
  if (guardrails.allowedProviders.providers.length === 0) {
    return "Any configured provider";
  }

  return getProviderLabels(guardrails.allowedProviders.providers).join(", ");
}

function hasUnmanagedGuardrailWarnings(guardrails: ProjectGuardrailsForAdmin) {
  return (
    guardrails.unmanagedPolicyWarnings.workspace.count > 0 ||
    guardrails.unmanagedPolicyWarnings.project.count > 0
  );
}

export default async function ProjectDetailPage({
  params,
  searchParams,
}: ProjectDetailPageProps) {
  const resolvedParams = await params;
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const noticeState = getDetailNoticeState({
    notice: resolvedSearchParams?.notice,
    error: resolvedSearchParams?.error,
  });
  const snapshot = await loadProjectDetailSnapshot(resolvedParams.slug);

  if (!snapshot.available) {
    return (
      <ControlPlanePanel
        title="Database state unavailable"
        description="Project detail stays server-rendered and DB-backed; there is no fake local-only project settings surface."
      >
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-5 text-sm leading-6 text-rose-700">
          {snapshot.errorMessage}
        </div>
      </ControlPlanePanel>
    );
  }

  if (!snapshot.found) {
    return (
      <ControlPlanePanel
        title="Project not found"
        description="This link no longer resolves to a real project in the current admin workspace."
      >
        <div className="space-y-4 rounded-2xl border border-dashed border-[hsl(var(--border))] bg-card p-5 text-sm text-[hsl(var(--muted))]">
          <p>
            No project matched{" "}
            <span className="font-mono">{snapshot.requestedSlug}</span> in{" "}
            {snapshot.workspaceContext.workspace.name}.
          </p>
          <Link
            href="/projects"
            className="inline-flex items-center rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--card-muted))] px-4 py-2 font-semibold text-[hsl(var(--foreground))] transition-colors hover:border-[hsl(var(--foreground))]"
          >
            Back to Projects
          </Link>
        </div>
      </ControlPlanePanel>
    );
  }

  const { project } = snapshot;
  const {
    public: { gatewayUrl },
  } = loadAdminConfig();

  return (
    <div className="grid gap-6">
      {noticeState ? (
        <div
          className={`rounded-2xl border px-4 py-4 text-sm ${getNoticeClasses(noticeState.tone)}`}
        >
          {noticeState.message}
        </div>
      ) : null}

      <ControlPlanePanel
        title="Project summary"
        description="Keep the basics, project-scoped key lifecycle, and the two narrow provider guardrails together here without reopening wider settings scope."
      >
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
          <article className="rounded-2xl border border-[hsl(var(--border))] bg-card p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-lg font-semibold text-[hsl(var(--foreground))]">
                    {project.name}
                  </p>
                  {snapshot.workspaceContext.project?.id === project.id ? (
                    <StatusBadge tone="info">current admin project</StatusBadge>
                  ) : null}
                  <StatusBadge tone={getProjectStatusTone(project.status)}>
                    {project.status}
                  </StatusBadge>
                </div>
                <p className="mt-2 font-mono text-sm text-[hsl(var(--muted))]">
                  {project.slug}
                </p>
                <p className="mt-3 text-sm text-[hsl(var(--muted))]">
                  {getStatusSummaryCopy(project.status)}
                </p>
              </div>

              <Link
                href="/projects"
                className="inline-flex items-center rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--card-muted))] px-4 py-2 text-sm font-semibold text-[hsl(var(--foreground))] transition-colors hover:border-[hsl(var(--foreground))]"
              >
                Back to Projects
              </Link>
            </div>
          </article>

          <article className="rounded-2xl border border-[hsl(var(--border))] bg-card p-4 text-sm text-[hsl(var(--muted))]">
            <p className="font-semibold text-[hsl(var(--foreground))]">
              Activity
            </p>
            <p className="mt-3">Created: {formatDateTime(project.createdAt)}</p>
            <p className="mt-1">Updated: {formatDateTime(project.updatedAt)}</p>
            <p className="mt-3">
              Workspace: {snapshot.workspaceContext.workspace.name}
            </p>
            <p className="mt-1">
              Default workspace mode:{" "}
              {snapshot.workspaceContext.workspace.defaultMode}
            </p>
          </article>
        </div>
      </ControlPlanePanel>

      <ControlPlanePanel
        title="API keys"
        description="Generate only project-scoped gateway keys here, reveal the raw value once, and keep last-used visibility next to the project that owns the traffic."
      >
        <div className="grid gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
          <ProjectApiKeyCreateForm
            workspaceId={project.workspaceId}
            projectId={project.id}
            projectSlug={project.slug}
            projectStatus={project.status}
            gatewayUrl={gatewayUrl}
          />

          <article className="rounded-2xl border border-[hsl(var(--border))] bg-card p-4 text-sm text-[hsl(var(--muted))]">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-semibold text-[hsl(var(--foreground))]">
                  Key summaries
                </p>
                <p className="mt-3">
                  The admin stores only `key_prefix` and `key_hash`. This list
                  keeps status and `last_used_at` readable without making the
                  raw key recoverable again.
                </p>
              </div>
            </div>

            <div className="mt-4 space-y-3">
              {snapshot.apiKeys.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-[hsl(var(--border))] px-4 py-5 text-sm text-[hsl(var(--muted))]">
                  No project API keys exist yet. Generate the first key on the
                  left, copy it once, and use the snippet for a real request.
                </div>
              ) : (
                snapshot.apiKeys.map((apiKey) => (
                  <article
                    key={apiKey.id}
                    className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card-muted))] p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-semibold text-[hsl(var(--foreground))]">
                            {apiKey.name}
                          </p>
                          <StatusBadge
                            tone={getGatewayApiKeyStatusTone(apiKey.status)}
                          >
                            {apiKey.status}
                          </StatusBadge>
                        </div>
                        <p className="mt-2 font-mono text-xs text-[hsl(var(--muted))]">
                          {apiKey.keyPrefix}
                        </p>
                      </div>

                      {apiKey.status === "active" ? (
                        <form action={revokeProjectGatewayApiKeyFromAdmin}>
                          <input
                            type="hidden"
                            name="workspaceId"
                            value={project.workspaceId}
                          />
                          <input
                            type="hidden"
                            name="projectId"
                            value={project.id}
                          />
                          <input
                            type="hidden"
                            name="currentSlug"
                            value={project.slug}
                          />
                          <input
                            type="hidden"
                            name="apiKeyId"
                            value={apiKey.id}
                          />

                          <button
                            type="submit"
                            className="inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-800"
                          >
                            Revoke key
                          </button>
                        </form>
                      ) : null}
                    </div>

                    <div className="mt-4 rounded-2xl border border-[hsl(var(--border))] bg-card p-3 text-sm text-[hsl(var(--muted))]">
                      <p>Created: {formatDateTime(apiKey.createdAt)}</p>
                      <p className="mt-1">
                        Last used: {formatDateTime(apiKey.lastUsedAt)}
                      </p>
                      {apiKey.expiresAt ? (
                        <p className="mt-1">
                          Expires: {formatDateTime(apiKey.expiresAt)}
                        </p>
                      ) : null}
                    </div>
                  </article>
                ))
              )}
            </div>
          </article>
        </div>
      </ControlPlanePanel>

      <ControlPlanePanel
        title="Project settings"
        description="Sprint 2 only exposes the project basics here: name, project link, and whether the project is active."
      >
        <div className="grid gap-4 xl:grid-cols-3">
          <article className="rounded-2xl border border-[hsl(var(--border))] bg-card p-4 text-sm text-[hsl(var(--muted))]">
            <p className="font-semibold text-[hsl(var(--foreground))]">
              Project name
            </p>
            <p className="mt-3">
              Use the name your team recognizes in daily work.
            </p>

            <form action={renameProjectFromAdmin} className="mt-4 space-y-3">
              <input
                type="hidden"
                name="workspaceId"
                value={project.workspaceId}
              />
              <input type="hidden" name="projectId" value={project.id} />
              <input type="hidden" name="currentSlug" value={project.slug} />

              <div className="space-y-2">
                <label
                  htmlFor="project-detail-name"
                  className="text-sm font-semibold text-[hsl(var(--foreground))]"
                >
                  Name
                </label>
                <input
                  id="project-detail-name"
                  name="name"
                  type="text"
                  defaultValue={project.name}
                  className="w-full rounded-2xl border border-[hsl(var(--border))] bg-card px-4 py-3 text-sm text-[hsl(var(--foreground))]"
                />
              </div>

              <button
                type="submit"
                className="inline-flex items-center rounded-full border border-[hsl(var(--primary))] bg-[hsl(var(--primary))] px-4 py-2 text-sm font-semibold text-white"
              >
                Save name
              </button>
            </form>
          </article>

          <article className="rounded-2xl border border-[hsl(var(--border))] bg-card p-4 text-sm text-[hsl(var(--muted))]">
            <p className="font-semibold text-[hsl(var(--foreground))]">
              Project link
            </p>
            <p className="mt-3">
              Keep this short and readable. It is the path used for this project
              inside the admin.
            </p>

            <form
              action={updateProjectSlugFromAdmin}
              className="mt-4 space-y-3"
            >
              <input
                type="hidden"
                name="workspaceId"
                value={project.workspaceId}
              />
              <input type="hidden" name="projectId" value={project.id} />
              <input type="hidden" name="currentSlug" value={project.slug} />

              <div className="space-y-2">
                <label
                  htmlFor="project-detail-slug"
                  className="text-sm font-semibold text-[hsl(var(--foreground))]"
                >
                  Link
                </label>
                <input
                  id="project-detail-slug"
                  name="slug"
                  type="text"
                  defaultValue={project.slug}
                  className="w-full rounded-2xl border border-[hsl(var(--border))] bg-card px-4 py-3 text-sm text-[hsl(var(--foreground))]"
                />
              </div>

              <button
                type="submit"
                className="inline-flex items-center rounded-full border border-[hsl(var(--primary))] bg-[hsl(var(--primary))] px-4 py-2 text-sm font-semibold text-white"
              >
                Save link
              </button>
            </form>
          </article>

          <article className="rounded-2xl border border-[hsl(var(--border))] bg-card p-4 text-sm text-[hsl(var(--muted))]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-semibold text-[hsl(var(--foreground))]">
                Project status
              </p>
              <StatusBadge tone={getProjectStatusTone(project.status)}>
                {project.status}
              </StatusBadge>
            </div>
            <p className="mt-3">{getStatusActionCopy(project.status)}</p>
            <p className="mt-3">
              Inactive projects stay out of new project-scoped key creation and
              request routing until you activate them again.
            </p>

            <form
              action={
                project.status === "active"
                  ? deactivateProjectFromAdmin
                  : activateProjectFromAdmin
              }
              className="mt-4"
            >
              <input
                type="hidden"
                name="workspaceId"
                value={project.workspaceId}
              />
              <input type="hidden" name="projectId" value={project.id} />
              <input type="hidden" name="currentSlug" value={project.slug} />

              <button
                type="submit"
                className={`inline-flex items-center rounded-full px-4 py-2 text-sm font-semibold ${
                  project.status === "active"
                    ? "border border-amber-300 bg-amber-50 text-amber-800"
                    : "border border-[hsl(var(--primary))] bg-[hsl(var(--primary))] text-white"
                }`}
              >
                {project.status === "active"
                  ? "Deactivate project"
                  : "Activate project"}
              </button>
            </form>
          </article>
        </div>
      </ControlPlanePanel>

      <ControlPlanePanel
        title="Guardrails"
        description="Sprint 2 keeps project guardrails narrow here: choose a preferred provider, limit which providers this project can use, and leave broader policy management out of the UI."
      >
        <div className="space-y-4">
          {hasUnmanagedGuardrailWarnings(snapshot.guardrails) ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-800">
              <p className="font-semibold">
                Other runtime guardrails are active outside this page.
              </p>
              <p className="mt-2 leading-6">
                Sprint 2 keeps this detail page limited to preferred provider
                and allowed providers, so the rest stays read-only here.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {snapshot.guardrails.unmanagedPolicyWarnings.workspace.count >
                0 ? (
                  <span className="inline-flex items-center rounded-full border border-amber-300 bg-white/70 px-3 py-1 font-semibold">
                    Workspace:{" "}
                    {
                      snapshot.guardrails.unmanagedPolicyWarnings.workspace
                        .count
                    }{" "}
                    active
                  </span>
                ) : null}
                {snapshot.guardrails.unmanagedPolicyWarnings.project.count >
                0 ? (
                  <span className="inline-flex items-center rounded-full border border-amber-300 bg-white/70 px-3 py-1 font-semibold">
                    Project:{" "}
                    {snapshot.guardrails.unmanagedPolicyWarnings.project.count}{" "}
                    active
                  </span>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="grid gap-4 xl:grid-cols-2">
            <article className="rounded-2xl border border-[hsl(var(--border))] bg-card p-4 text-sm text-[hsl(var(--muted))]">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold text-[hsl(var(--foreground))]">
                  Preferred provider
                </p>
                <StatusBadge
                  tone={getGuardrailStatusTone(
                    snapshot.guardrails.preferredProvider.enabled,
                  )}
                >
                  {snapshot.guardrails.preferredProvider.enabled
                    ? "configured"
                    : "not configured"}
                </StatusBadge>
              </div>

              <p className="mt-3 text-lg font-semibold text-[hsl(var(--foreground))]">
                {getPreferredProviderSummary(snapshot.guardrails)}
              </p>
              <p className="mt-2 leading-6">
                This project tends toward this provider when more than one
                provider still fits the request.
              </p>
              <p className="mt-3">
                Last updated:{" "}
                {formatDateTime(
                  snapshot.guardrails.preferredProvider.updatedAt,
                )}
              </p>

              <form
                action={updateProjectPreferredProviderFromAdmin}
                className="mt-4 space-y-3"
              >
                <input
                  type="hidden"
                  name="workspaceId"
                  value={project.workspaceId}
                />
                <input type="hidden" name="projectId" value={project.id} />
                <input type="hidden" name="currentSlug" value={project.slug} />

                <div className="space-y-2">
                  <label
                    htmlFor="project-preferred-provider"
                    className="text-sm font-semibold text-[hsl(var(--foreground))]"
                  >
                    Preferred provider
                  </label>
                  <select
                    id="project-preferred-provider"
                    name="provider"
                    defaultValue={
                      snapshot.guardrails.preferredProvider.provider ?? ""
                    }
                    className="w-full rounded-2xl border border-[hsl(var(--border))] bg-card px-4 py-3 text-sm text-[hsl(var(--foreground))]"
                  >
                    <option value="">No preferred provider</option>
                    {PROVIDER_NAME_VALUES.map((provider) => (
                      <option key={provider} value={provider}>
                        {getProviderLabel(provider)}
                      </option>
                    ))}
                  </select>
                  <p className="text-sm leading-6">
                    {snapshot.guardrails.allowedProviders.enabled
                      ? "Because allowed providers are active here, the preferred provider must stay inside that list."
                      : "Leave this unset when the project should not lean toward one provider over another."}
                  </p>
                </div>

                <button
                  type="submit"
                  className="inline-flex items-center rounded-full border border-[hsl(var(--primary))] bg-[hsl(var(--primary))] px-4 py-2 text-sm font-semibold text-white"
                >
                  Save preferred provider
                </button>
              </form>
            </article>

            <article className="rounded-2xl border border-[hsl(var(--border))] bg-card p-4 text-sm text-[hsl(var(--muted))]">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold text-[hsl(var(--foreground))]">
                  Allowed providers
                </p>
                <StatusBadge
                  tone={getGuardrailStatusTone(
                    snapshot.guardrails.allowedProviders.enabled,
                  )}
                >
                  {snapshot.guardrails.allowedProviders.enabled
                    ? "configured"
                    : "not configured"}
                </StatusBadge>
              </div>

              <p className="mt-3 text-lg font-semibold text-[hsl(var(--foreground))]">
                {getAllowedProvidersSummary(snapshot.guardrails)}
              </p>
              <p className="mt-2 leading-6">
                Limit this project to the providers you trust for this traffic.
              </p>
              <p className="mt-3">
                Last updated:{" "}
                {formatDateTime(snapshot.guardrails.allowedProviders.updatedAt)}
              </p>

              <form
                action={updateProjectAllowedProvidersFromAdmin}
                className="mt-4 space-y-3"
              >
                <input
                  type="hidden"
                  name="workspaceId"
                  value={project.workspaceId}
                />
                <input type="hidden" name="projectId" value={project.id} />
                <input type="hidden" name="currentSlug" value={project.slug} />

                <fieldset className="space-y-3">
                  <legend className="text-sm font-semibold text-[hsl(var(--foreground))]">
                    Providers this project may use
                  </legend>
                  <div className="space-y-2">
                    {PROVIDER_NAME_VALUES.map((provider) => (
                      <label
                        key={provider}
                        className="flex items-center gap-3 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card-muted))] px-4 py-3 text-sm text-[hsl(var(--foreground))]"
                      >
                        <input
                          type="checkbox"
                          name="allowedProviders"
                          value={provider}
                          defaultChecked={snapshot.guardrails.allowedProviders.providers.includes(
                            provider,
                          )}
                          className="h-4 w-4 rounded border-[hsl(var(--border))]"
                        />
                        <span>{getProviderLabel(provider)}</span>
                      </label>
                    ))}
                  </div>
                  <p className="text-sm leading-6">
                    {snapshot.guardrails.preferredProvider.provider
                      ? "If you keep a preferred provider, it must stay selected here. Leave both unchecked to remove the restriction."
                      : "Leave both unchecked when this project should be able to use any configured provider."}
                  </p>
                </fieldset>

                <button
                  type="submit"
                  className="inline-flex items-center rounded-full border border-[hsl(var(--primary))] bg-[hsl(var(--primary))] px-4 py-2 text-sm font-semibold text-white"
                >
                  Save allowed providers
                </button>
              </form>
            </article>
          </div>
        </div>
      </ControlPlanePanel>
    </div>
  );
}
