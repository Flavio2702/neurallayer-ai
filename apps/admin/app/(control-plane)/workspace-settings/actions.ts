"use server";

import {
  upsertWorkspaceBudgetCap,
  WorkspaceBudgetCapServiceError,
} from "@neuralayer/db";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireAdminSession } from "@/lib/admin-access-gate";

type WorkspaceSettingsNotice = "budget_cap_saved" | "budget_cap_cleared";

function revalidateWorkspaceSettingsSurfaces() {
  revalidatePath("/");
  revalidatePath("/workspace-settings");
  revalidatePath("/audit");
}

function redirectToWorkspaceSettings(input: {
  notice?: WorkspaceSettingsNotice;
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

  redirect(
    query.length > 0 ? `/workspace-settings?${query}` : "/workspace-settings",
  );
}

function getBudgetCapContext(formData: FormData) {
  const workspaceId = String(formData.get("workspaceId") ?? "").trim();
  const intent = String(formData.get("intent") ?? "").trim();

  if (!workspaceId) {
    redirectToWorkspaceSettings({
      error: "Invalid workspace context. Refresh the page and try again.",
    });
  }

  if (intent !== "save" && intent !== "clear") {
    redirectToWorkspaceSettings({
      error:
        "Invalid workspace settings action. Refresh the page and try again.",
    });
  }

  return {
    workspaceId,
    intent,
  } as const;
}

function getBudgetCapErrorMessage(error: WorkspaceBudgetCapServiceError) {
  switch (error.code) {
    case "workspace_not_found":
      return "The admin workspace is no longer available. Refresh the page and try again.";
    case "invalid_budget_cap_limit":
      return "Enter a budget cap in USD using a non-negative number.";
    default:
      return "The workspace budget cap update could not be completed.";
  }
}

export async function updateWorkspaceBudgetCapFromAdmin(formData: FormData) {
  await requireAdminSession();

  const context = getBudgetCapContext(formData);

  if (context.intent === "clear") {
    try {
      await upsertWorkspaceBudgetCap({
        workspaceId: context.workspaceId,
        limitUsd: null,
      });
    } catch (error) {
      if (error instanceof WorkspaceBudgetCapServiceError) {
        redirectToWorkspaceSettings({
          error: getBudgetCapErrorMessage(error),
        });
      }

      redirectToWorkspaceSettings({
        error:
          "Workspace budget cap clear failed unexpectedly. Refresh the page and try again.",
      });
    }

    revalidateWorkspaceSettingsSurfaces();
    redirectToWorkspaceSettings({
      notice: "budget_cap_cleared",
    });
  }

  const rawLimitUsd = String(formData.get("limitUsd") ?? "").trim();

  if (rawLimitUsd.length === 0) {
    redirectToWorkspaceSettings({
      error: "Enter a budget cap in USD before saving it.",
    });
  }

  const limitUsd = Number(rawLimitUsd);

  if (!Number.isFinite(limitUsd) || limitUsd < 0) {
    redirectToWorkspaceSettings({
      error: "Enter a budget cap in USD using a non-negative number.",
    });
  }

  try {
    await upsertWorkspaceBudgetCap({
      workspaceId: context.workspaceId,
      limitUsd,
    });
  } catch (error) {
    if (error instanceof WorkspaceBudgetCapServiceError) {
      redirectToWorkspaceSettings({
        error: getBudgetCapErrorMessage(error),
      });
    }

    redirectToWorkspaceSettings({
      error:
        "Workspace budget cap save failed unexpectedly. Refresh the page and try again.",
    });
  }

  revalidateWorkspaceSettingsSurfaces();
  redirectToWorkspaceSettings({
    notice: "budget_cap_saved",
  });
}
