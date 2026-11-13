import {
  getWorkspaceBudgetCap,
  resolveDefaultAdminWorkspace,
} from "@neuralayer/db";

import { ControlPlanePanel } from "@/components/control-plane-panel";
import { StatusBadge } from "@/components/status-badge";
import { formatCurrencyUsd, formatDateTime } from "@/lib/format";

import { updateWorkspaceBudgetCapFromAdmin } from "./actions";

interface WorkspaceSettingsPageProps {
  searchParams?: Promise<{
    notice?: string;
    error?: string;
  }>;
}

type WorkspaceSettingsSnapshot =
  | {
      available: false;
      errorMessage: string;
    }
  | {
      available: true;
      workspaceContext: NonNullable<
        Awaited<ReturnType<typeof resolveDefaultAdminWorkspace>>
      >;
      budgetCap: Awaited<ReturnType<typeof getWorkspaceBudgetCap>>;
    };

async function loadWorkspaceSettingsSnapshot(): Promise<WorkspaceSettingsSnapshot> {
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
      budgetCap: await getWorkspaceBudgetCap(workspaceContext.workspace.id),
    };
  } catch (error) {
    return {
      available: false,
      errorMessage:
        error instanceof Error
          ? error.message
          : "The Workspace settings page could not load database-backed state.",
    };
  }
}

function getNoticeClasses(tone: "success" | "danger") {
  return tone === "success"
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : "border-rose-200 bg-rose-50 text-rose-700";
}

function getNoticeState(input: { notice?: string; error?: string }) {
  switch (input.notice) {
    case "budget_cap_saved":
      return {
        tone: "success",
        message:
          "Workspace budget cap saved. Sprint 2 keeps this as the only workspace-level guardrail exposed in the admin.",
      } as const;
    case "budget_cap_cleared":
      return {
        tone: "success",
        message:
          "Workspace budget cap cleared. No workspace-level budget guardrail is currently configured in the admin.",
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

function getBudgetCapStatusCopy(enabled: boolean) {
  return enabled
    ? "The router can hard-block new workspace traffic once recorded monthly spend reaches this limit."
    : "No workspace-level budget cap is configured right now, so Sprint 2 leaves this guardrail unset.";
}

export default async function WorkspaceSettingsPage({
  searchParams,
}: WorkspaceSettingsPageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const noticeState = getNoticeState({
    notice: resolvedSearchParams?.notice,
    error: resolvedSearchParams?.error,
  });
  const snapshot = await loadWorkspaceSettingsSnapshot();

  if (!snapshot.available) {
    return (
      <ControlPlanePanel
        title="Database state unavailable"
        description="Workspace settings stays server-rendered and DB-backed; there is no fake local-only settings state."
      >
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-5 text-sm leading-6 text-rose-700">
          {snapshot.errorMessage}
        </div>
      </ControlPlanePanel>
    );
  }

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
        title="Workspace guardrail scope"
        description="Sprint 2 intentionally keeps workspace-level control narrow. This page only exposes the workspace budget cap and does not reopen a generic settings or policies surface."
      >
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,0.95fr)]">
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
              Workspace-level scope stays intentionally small here. Project
              guardrails continue to live inside project detail, and `Policies`
              remains out of scope for Sprint 2.
            </p>
          </article>

          <article className="rounded-2xl border border-[hsl(var(--border))] bg-card p-4 text-sm text-[hsl(var(--muted))]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-semibold text-[hsl(var(--foreground))]">
                Budget cap status
              </p>
              <StatusBadge
                tone={snapshot.budgetCap.enabled ? "warning" : "neutral"}
              >
                {snapshot.budgetCap.enabled ? "configured" : "not configured"}
              </StatusBadge>
            </div>
            <p className="mt-3 text-lg font-semibold text-[hsl(var(--foreground))]">
              {snapshot.budgetCap.enabled
                ? formatCurrencyUsd(snapshot.budgetCap.limitUsd)
                : "Not configured"}
            </p>
            <p className="mt-2">
              {getBudgetCapStatusCopy(snapshot.budgetCap.enabled)}
            </p>
            <p className="mt-3">
              Last updated: {formatDateTime(snapshot.budgetCap.updatedAt)}
            </p>
          </article>
        </div>
      </ControlPlanePanel>

      <ControlPlanePanel
        title="Workspace budget cap"
        description="Use this form to read or update the only workspace-level guardrail exposed in Sprint 2. Saving a value sets a hard-block budget cap in the same DB-backed policy storage used by the router."
      >
        <div className="grid gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
          <form
            action={updateWorkspaceBudgetCapFromAdmin}
            className="rounded-2xl border border-[hsl(var(--border))] bg-card p-4"
          >
            <input
              type="hidden"
              name="workspaceId"
              value={snapshot.workspaceContext.workspace.id}
            />

            <div className="space-y-2">
              <label
                htmlFor="workspace-budget-cap"
                className="text-sm font-semibold text-[hsl(var(--foreground))]"
              >
                Monthly budget cap (USD)
              </label>
              <input
                id="workspace-budget-cap"
                name="limitUsd"
                type="number"
                min="0"
                step="0.01"
                defaultValue={
                  snapshot.budgetCap.enabled &&
                  typeof snapshot.budgetCap.limitUsd === "number"
                    ? snapshot.budgetCap.limitUsd
                    : undefined
                }
                placeholder="250"
                className="w-full rounded-2xl border border-[hsl(var(--border))] bg-card px-4 py-3 text-sm text-[hsl(var(--foreground))]"
              />
              <p className="text-sm leading-6 text-[hsl(var(--muted))]">
                Enter a non-negative USD amount. Use clear only when you want no
                workspace-level budget cap active in the admin.
              </p>
            </div>

            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="submit"
                name="intent"
                value="save"
                className="inline-flex items-center rounded-full border border-[hsl(var(--primary))] bg-[hsl(var(--primary))] px-4 py-2 text-sm font-semibold text-white"
              >
                Save budget cap
              </button>

              {snapshot.budgetCap.enabled ? (
                <button
                  type="submit"
                  name="intent"
                  value="clear"
                  className="inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-800"
                >
                  Clear budget cap
                </button>
              ) : null}
            </div>
          </form>

          <article className="rounded-2xl border border-[hsl(var(--border))] bg-card p-4 text-sm text-[hsl(var(--muted))]">
            <p className="font-semibold text-[hsl(var(--foreground))]">
              What this page does not do
            </p>
            <p className="mt-3">
              It does not expose generic workspace settings, project guardrails,
              routing profile editing, or a `Policies` browser.
            </p>
            <p className="mt-3">
              Sprint 2 keeps this page limited to one workspace-level choice so
              the control plane stays operational and readable.
            </p>
            <p className="mt-3">
              If you need provider selection or allowed-provider controls, those
              remain project-level concerns and stay close to project detail.
            </p>
          </article>
        </div>
      </ControlPlanePanel>
    </div>
  );
}
