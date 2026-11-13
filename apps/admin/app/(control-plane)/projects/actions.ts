"use server";

import { loadAdminConfig } from "@neuralayer/config";
import { PROVIDER_NAME_VALUES, type ProviderName } from "@neuralayer/core";
import {
  activateProject,
  createProject,
  createProjectGatewayApiKey,
  deactivateProject,
  GatewayApiKeyLifecycleError,
  getProjectGuardrailsForAdmin,
  ProjectGuardrailsServiceError,
  ProjectLifecycleError,
  type ProjectSummary,
  renameProject,
  revokeProjectGatewayApiKey,
  updateProjectSlug,
  upsertProjectAllowedProviders,
  upsertProjectPreferredProvider,
} from "@neuralayer/db";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireAdminSession } from "@/lib/admin-access-gate";
import { buildGatewayChatCompletionsCurlSnippet } from "@/lib/gateway-curl-snippet";
import {
  initialProjectApiKeyCreateFormState,
  type ProjectApiKeyCreateFormState,
} from "@/lib/project-api-key-create-form-state";

type ProjectDetailNotice =
  | "project_created"
  | "project_name_updated"
  | "project_slug_updated"
  | "project_activated"
  | "project_deactivated"
  | "preferred_provider_saved"
  | "preferred_provider_cleared"
  | "allowed_providers_saved"
  | "allowed_providers_cleared"
  | "api_key_revoked";

function isProviderName(value: string): value is ProviderName {
  return PROVIDER_NAME_VALUES.includes(value as ProviderName);
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

function getProjectDetailPath(slug: string) {
  return `/projects/${encodeURIComponent(slug)}`;
}

function revalidateProjectSurfaces(input: { detailSlugs?: string[] } = {}) {
  revalidatePath("/");
  revalidatePath("/projects");
  revalidatePath("/audit");

  for (const slug of new Set(
    (input.detailSlugs ?? []).filter((value) => value.length > 0),
  )) {
    revalidatePath(getProjectDetailPath(slug));
  }
}

function redirectToProjects(input: { error?: string }): never {
  const searchParams = new URLSearchParams();

  if (input.error) {
    searchParams.set("error", input.error);
  }

  const query = searchParams.toString();

  redirect(query.length > 0 ? `/projects?${query}` : "/projects");
}

function redirectToProjectDetail(input: {
  slug: string;
  notice?: ProjectDetailNotice;
  error?: string;
}): never {
  const searchParams = new URLSearchParams();

  if (input.notice) {
    searchParams.set("notice", input.notice);
  }

  if (input.error) {
    searchParams.set("error", input.error);
  }

  const query = searchParams.toString();
  const path = getProjectDetailPath(input.slug);

  redirect(query.length > 0 ? `${path}?${query}` : path);
}

function redirectToCurrentProjectOrProjects(input: {
  currentSlug?: string;
  error: string;
}): never {
  if (input.currentSlug) {
    redirectToProjectDetail({
      slug: input.currentSlug,
      error: input.error,
    });
  }

  redirectToProjects({
    error: input.error,
  });
}

function getProjectFormContext(formData: FormData) {
  return {
    workspaceId: String(formData.get("workspaceId") ?? "").trim(),
    projectId: String(formData.get("projectId") ?? "").trim(),
    currentSlug: String(formData.get("currentSlug") ?? "").trim(),
  };
}

function getProjectLookupContext(formData: FormData) {
  const context = getProjectFormContext(formData);

  if (!context.workspaceId || !context.projectId) {
    redirectToCurrentProjectOrProjects({
      currentSlug: context.currentSlug,
      error: "Invalid project context. Return to Projects and try again.",
    });
  }

  return context;
}

function getKnownProjectErrorMessage(
  error: ProjectLifecycleError,
  input: {
    invalidName?: string;
    invalidSlug?: string;
  } = {},
) {
  switch (error.code) {
    case "invalid_project_name":
      return (
        input.invalidName ?? "Enter a project name before saving this project."
      );
    case "invalid_project_slug":
      return (
        input.invalidSlug ??
        "Enter a short project link with at least one letter or number."
      );
    case "project_slug_conflict":
      return "That project link is already in use in this workspace.";
    case "workspace_not_found":
      return "The admin workspace is no longer available. Refresh the page and try again.";
    case "project_not_found":
      return "This project is no longer available. Return to Projects and refresh the list.";
    default:
      return "The project update could not be completed.";
  }
}

function getKnownProjectGuardrailErrorMessage(
  error: ProjectGuardrailsServiceError,
) {
  switch (error.code) {
    case "workspace_not_found":
      return "The admin workspace is no longer available. Refresh the page and try again.";
    case "project_not_found":
      return "This project is no longer available. Return to Projects and refresh the list.";
    case "invalid_preferred_provider":
      return "Select OpenAI, Anthropic, or leave preferred provider unset.";
    case "invalid_allowed_provider":
      return "Select only the supported providers listed here.";
    default:
      return "The project guardrail update could not be completed.";
  }
}

function handleProjectMutationFailure(
  error: unknown,
  input: {
    currentSlug?: string;
    invalidName?: string;
    invalidSlug?: string;
    unexpectedMessage: string;
  },
): never {
  if (error instanceof ProjectLifecycleError) {
    const message = getKnownProjectErrorMessage(error, {
      invalidName: input.invalidName,
      invalidSlug: input.invalidSlug,
    });

    if (
      error.code === "workspace_not_found" ||
      error.code === "project_not_found"
    ) {
      redirectToProjects({
        error: message,
      });
    }

    redirectToCurrentProjectOrProjects({
      currentSlug: input.currentSlug,
      error: message,
    });
  }

  redirectToCurrentProjectOrProjects({
    currentSlug: input.currentSlug,
    error: input.unexpectedMessage,
  });
}

function handleProjectGuardrailMutationFailure(
  error: unknown,
  input: {
    currentSlug?: string;
    unexpectedMessage: string;
  },
): never {
  if (error instanceof ProjectGuardrailsServiceError) {
    const message = getKnownProjectGuardrailErrorMessage(error);

    if (
      error.code === "workspace_not_found" ||
      error.code === "project_not_found"
    ) {
      redirectToProjects({
        error: message,
      });
    }

    redirectToCurrentProjectOrProjects({
      currentSlug: input.currentSlug,
      error: message,
    });
  }

  redirectToCurrentProjectOrProjects({
    currentSlug: input.currentSlug,
    error: input.unexpectedMessage,
  });
}

async function loadProjectGuardrailsForAdminOrRedirect(input: {
  workspaceId: string;
  projectId: string;
  currentSlug?: string;
}) {
  try {
    return await getProjectGuardrailsForAdmin({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
    });
  } catch (error) {
    handleProjectGuardrailMutationFailure(error, {
      currentSlug: input.currentSlug,
      unexpectedMessage:
        "Project guardrails could not be loaded. Refresh the page and try again.",
    });
  }
}

function getKnownGatewayApiKeyErrorMessage(
  error: GatewayApiKeyLifecycleError,
  input: {
    invalidName?: string;
    apiKeyMissing?: string;
  } = {},
) {
  switch (error.code) {
    case "invalid_api_key_name":
      return (
        input.invalidName ?? "Enter a key name before generating this key."
      );
    case "project_inactive":
      return "Activate this project before generating a new project API key.";
    case "workspace_not_found":
      return "The admin workspace is no longer available. Refresh the page and try again.";
    case "project_not_found":
      return "This project is no longer available. Return to Projects and refresh the list.";
    case "api_key_not_found":
      return (
        input.apiKeyMissing ?? "This project API key is no longer available."
      );
    default:
      return "The project API key update could not be completed.";
  }
}

async function createProjectAndRedirect(input: {
  workspaceId: string;
  name: string;
}): Promise<ProjectSummary> {
  return createProject(input);
}

export async function createProjectFromAdmin(formData: FormData) {
  await requireAdminSession();

  const workspaceId = String(formData.get("workspaceId") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();

  if (!workspaceId) {
    redirectToProjects({
      error: "Invalid workspace context.",
    });
  }

  if (!name) {
    redirectToProjects({
      error: "Enter a project name before creating it.",
    });
  }

  let project: ProjectSummary;

  try {
    project = await createProjectAndRedirect({
      workspaceId,
      name,
    });
  } catch (error) {
    if (error instanceof ProjectLifecycleError) {
      redirectToProjects({
        error: getKnownProjectErrorMessage(error, {
          invalidName: "Enter a project name before creating it.",
        }),
      });
    }

    redirectToProjects({
      error:
        "Project creation failed unexpectedly. Try again after checking the database-backed admin state.",
    });
  }

  revalidateProjectSurfaces({
    detailSlugs: [project.slug],
  });
  redirectToProjectDetail({
    slug: project.slug,
    notice: "project_created",
  });
}

export async function renameProjectFromAdmin(formData: FormData) {
  await requireAdminSession();

  const context = getProjectLookupContext(formData);
  const name = String(formData.get("name") ?? "").trim();

  if (!name) {
    redirectToCurrentProjectOrProjects({
      currentSlug: context.currentSlug,
      error: "Enter a project name before saving it.",
    });
  }

  let project: ProjectSummary;

  try {
    project = await renameProject({
      workspaceId: context.workspaceId,
      projectId: context.projectId,
      name,
    });
  } catch (error) {
    handleProjectMutationFailure(error, {
      currentSlug: context.currentSlug,
      invalidName: "Enter a project name before saving it.",
      unexpectedMessage:
        "Project name update failed unexpectedly. Refresh the page and try again.",
    });
  }

  revalidateProjectSurfaces({
    detailSlugs: [context.currentSlug, project.slug],
  });
  redirectToProjectDetail({
    slug: project.slug,
    notice: "project_name_updated",
  });
}

export async function updateProjectSlugFromAdmin(formData: FormData) {
  await requireAdminSession();

  const context = getProjectLookupContext(formData);
  const slug = String(formData.get("slug") ?? "").trim();

  if (!slug) {
    redirectToCurrentProjectOrProjects({
      currentSlug: context.currentSlug,
      error: "Enter a short project link before saving it.",
    });
  }

  let project: ProjectSummary;

  try {
    project = await updateProjectSlug({
      workspaceId: context.workspaceId,
      projectId: context.projectId,
      slug,
    });
  } catch (error) {
    handleProjectMutationFailure(error, {
      currentSlug: context.currentSlug,
      invalidSlug:
        "Enter a short project link with at least one letter or number.",
      unexpectedMessage:
        "Project link update failed unexpectedly. Refresh the page and try again.",
    });
  }

  revalidateProjectSurfaces({
    detailSlugs: [context.currentSlug, project.slug],
  });
  redirectToProjectDetail({
    slug: project.slug,
    notice: "project_slug_updated",
  });
}

export async function activateProjectFromAdmin(formData: FormData) {
  await requireAdminSession();

  const context = getProjectLookupContext(formData);

  let project: ProjectSummary;

  try {
    project = await activateProject({
      workspaceId: context.workspaceId,
      projectId: context.projectId,
    });
  } catch (error) {
    handleProjectMutationFailure(error, {
      currentSlug: context.currentSlug,
      unexpectedMessage:
        "Project activation failed unexpectedly. Refresh the page and try again.",
    });
  }

  revalidateProjectSurfaces({
    detailSlugs: [context.currentSlug, project.slug],
  });
  redirectToProjectDetail({
    slug: project.slug,
    notice: "project_activated",
  });
}

export async function deactivateProjectFromAdmin(formData: FormData) {
  await requireAdminSession();

  const context = getProjectLookupContext(formData);

  let project: ProjectSummary;

  try {
    project = await deactivateProject({
      workspaceId: context.workspaceId,
      projectId: context.projectId,
    });
  } catch (error) {
    handleProjectMutationFailure(error, {
      currentSlug: context.currentSlug,
      unexpectedMessage:
        "Project deactivation failed unexpectedly. Refresh the page and try again.",
    });
  }

  revalidateProjectSurfaces({
    detailSlugs: [context.currentSlug, project.slug],
  });
  redirectToProjectDetail({
    slug: project.slug,
    notice: "project_deactivated",
  });
}

function parsePreferredProviderInput(formData: FormData) {
  const rawProvider = String(formData.get("provider") ?? "").trim();

  if (rawProvider.length === 0) {
    return null;
  }

  if (!isProviderName(rawProvider)) {
    return undefined;
  }

  return rawProvider;
}

function parseAllowedProvidersInput(formData: FormData) {
  const rawProviders = formData
    .getAll("allowedProviders")
    .map((value) => String(value).trim())
    .filter((value) => value.length > 0);

  if (rawProviders.some((provider) => !isProviderName(provider))) {
    return undefined;
  }

  return sortProviderNames([...new Set(rawProviders.filter(isProviderName))]);
}

export async function updateProjectPreferredProviderFromAdmin(
  formData: FormData,
) {
  await requireAdminSession();

  const context = getProjectLookupContext(formData);
  const provider = parsePreferredProviderInput(formData);

  if (typeof provider === "undefined") {
    redirectToCurrentProjectOrProjects({
      currentSlug: context.currentSlug,
      error: "Select OpenAI, Anthropic, or leave preferred provider unset.",
    });
  }

  const currentGuardrails =
    await loadProjectGuardrailsForAdminOrRedirect(context);

  if (
    provider &&
    currentGuardrails.allowedProviders.enabled &&
    !currentGuardrails.allowedProviders.providers.includes(provider)
  ) {
    redirectToCurrentProjectOrProjects({
      currentSlug: context.currentSlug,
      error:
        "Keep the preferred provider inside the current allowed providers list, or clear that restriction first.",
    });
  }

  try {
    await upsertProjectPreferredProvider({
      workspaceId: context.workspaceId,
      projectId: context.projectId,
      provider,
    });
  } catch (error) {
    handleProjectGuardrailMutationFailure(error, {
      currentSlug: context.currentSlug,
      unexpectedMessage:
        "Preferred provider update failed unexpectedly. Refresh the page and try again.",
    });
  }

  revalidateProjectSurfaces({
    detailSlugs: [context.currentSlug],
  });
  redirectToProjectDetail({
    slug: context.currentSlug,
    notice:
      provider === null
        ? "preferred_provider_cleared"
        : "preferred_provider_saved",
  });
}

export async function updateProjectAllowedProvidersFromAdmin(
  formData: FormData,
) {
  await requireAdminSession();

  const context = getProjectLookupContext(formData);
  const providers = parseAllowedProvidersInput(formData);

  if (typeof providers === "undefined") {
    redirectToCurrentProjectOrProjects({
      currentSlug: context.currentSlug,
      error: "Select only the supported providers listed here.",
    });
  }

  const currentGuardrails =
    await loadProjectGuardrailsForAdminOrRedirect(context);
  const preferredProvider = currentGuardrails.preferredProvider.provider;

  if (
    preferredProvider &&
    providers.length > 0 &&
    !providers.includes(preferredProvider)
  ) {
    redirectToCurrentProjectOrProjects({
      currentSlug: context.currentSlug,
      error: `${getProviderLabel(preferredProvider)} is still set as the preferred provider. Keep it allowed or clear the preferred provider first.`,
    });
  }

  try {
    await upsertProjectAllowedProviders({
      workspaceId: context.workspaceId,
      projectId: context.projectId,
      providers,
    });
  } catch (error) {
    handleProjectGuardrailMutationFailure(error, {
      currentSlug: context.currentSlug,
      unexpectedMessage:
        "Allowed providers update failed unexpectedly. Refresh the page and try again.",
    });
  }

  revalidateProjectSurfaces({
    detailSlugs: [context.currentSlug],
  });
  redirectToProjectDetail({
    slug: context.currentSlug,
    notice:
      providers.length === 0
        ? "allowed_providers_cleared"
        : "allowed_providers_saved",
  });
}

export async function createProjectGatewayApiKeyFromAdmin(
  formData: FormData,
): Promise<ProjectApiKeyCreateFormState> {
  await requireAdminSession();

  const workspaceId = String(formData.get("workspaceId") ?? "").trim();
  const projectId = String(formData.get("projectId") ?? "").trim();
  const projectSlug = String(formData.get("projectSlug") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();

  if (!workspaceId || !projectId || !projectSlug) {
    return {
      ...initialProjectApiKeyCreateFormState,
      status: "error",
      message:
        "Invalid project context. Refresh the detail page and try again.",
    };
  }

  if (!name) {
    return {
      ...initialProjectApiKeyCreateFormState,
      status: "error",
      message: "Enter a key name before generating this key.",
    };
  }

  try {
    const createdApiKey = await createProjectGatewayApiKey({
      workspaceId,
      projectId,
      name,
    });
    const {
      public: { gatewayUrl },
    } = loadAdminConfig();

    return {
      status: "success",
      message:
        "Project API key created. Copy the raw key now: it is shown only in this success state.",
      rawKey: createdApiKey.rawKey,
      curlSnippet: buildGatewayChatCompletionsCurlSnippet({
        apiKey: createdApiKey.rawKey,
        gatewayUrl,
        projectId,
      }),
      apiKey: createdApiKey.apiKey,
    };
  } catch (error) {
    if (error instanceof GatewayApiKeyLifecycleError) {
      return {
        ...initialProjectApiKeyCreateFormState,
        status: "error",
        message: getKnownGatewayApiKeyErrorMessage(error, {
          invalidName: "Enter a key name before generating this key.",
        }),
      };
    }

    return {
      ...initialProjectApiKeyCreateFormState,
      status: "error",
      message:
        "Project API key generation failed unexpectedly. Refresh the page and try again.",
    };
  }
}

export async function revokeProjectGatewayApiKeyFromAdmin(formData: FormData) {
  await requireAdminSession();

  const context = getProjectLookupContext(formData);
  const apiKeyId = String(formData.get("apiKeyId") ?? "").trim();

  if (!apiKeyId) {
    redirectToCurrentProjectOrProjects({
      currentSlug: context.currentSlug,
      error: "Invalid project API key context. Refresh the page and try again.",
    });
  }

  try {
    await revokeProjectGatewayApiKey({
      workspaceId: context.workspaceId,
      projectId: context.projectId,
      apiKeyId,
    });
  } catch (error) {
    if (error instanceof GatewayApiKeyLifecycleError) {
      const message = getKnownGatewayApiKeyErrorMessage(error, {
        apiKeyMissing: "This project API key is no longer available.",
      });

      if (
        error.code === "workspace_not_found" ||
        error.code === "project_not_found"
      ) {
        redirectToProjects({
          error: message,
        });
      }

      redirectToCurrentProjectOrProjects({
        currentSlug: context.currentSlug,
        error: message,
      });
    }

    redirectToCurrentProjectOrProjects({
      currentSlug: context.currentSlug,
      error:
        "Project API key revoke failed unexpectedly. Refresh the page and try again.",
    });
  }

  revalidateProjectSurfaces({
    detailSlugs: [context.currentSlug],
  });
  redirectToProjectDetail({
    slug: context.currentSlug,
    notice: "api_key_revoked",
  });
}
