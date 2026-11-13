import type {
  WorkspaceSetupProgress,
  WorkspaceSetupProgressStep,
  WorkspaceSetupProgressStepId,
} from "@neuralayer/db";
import Link from "next/link";

import { ControlPlanePanel } from "@/components/control-plane-panel";
import { StatusBadge } from "@/components/status-badge";

const STEP_ACTIONS: Record<
  WorkspaceSetupProgressStepId,
  {
    href: string;
    label: string;
    helper: string;
  }
> = {
  provider_configured: {
    href: "/providers",
    label: "Open Providers",
    helper: "Save one real provider credential before touching project setup.",
  },
  provider_tested: {
    href: "/providers",
    label: "Open Providers",
    helper: "Run one explicit connection test on the current saved credential.",
  },
  project_created: {
    href: "/projects",
    label: "Open Projects",
    helper: "Create the first active project for partner traffic.",
  },
  api_key_generated: {
    href: "/projects",
    label: "Open Projects",
    helper: "Generate one active project-scoped key from project detail.",
  },
  first_request_sent: {
    href: "/playground",
    label: "Open Playground",
    helper:
      "Send one real request through the gateway path to close first-run.",
  },
};

function getPrimaryAction(nextStepId: WorkspaceSetupProgressStepId | null) {
  if (!nextStepId) {
    return {
      href: "/requests",
      label: "Open Requests",
      helper:
        "First-run is closed. Requests stays the primary operational surface once traffic starts flowing.",
    };
  }

  return STEP_ACTIONS[nextStepId];
}

function getStepCardClasses(input: {
  step: WorkspaceSetupProgressStep;
  isNext: boolean;
}) {
  if (input.step.completed) {
    return "border-emerald-200 bg-emerald-50";
  }

  if (input.isNext) {
    return "border-[hsl(var(--primary))] bg-[hsl(var(--primary-soft))]";
  }

  return "border-[hsl(var(--border))] bg-card";
}

function getStepBadge(step: WorkspaceSetupProgressStep, isNext: boolean) {
  if (step.completed) {
    return {
      tone: "success" as const,
      label: "Complete",
    };
  }

  if (isNext) {
    return {
      tone: "info" as const,
      label: "Next",
    };
  }

  return {
    tone: "neutral" as const,
    label: "Pending",
  };
}

export function SetupProgressPanel({
  progress,
}: {
  progress: WorkspaceSetupProgress;
}) {
  const nextStep = progress.steps.find((step) => !step.completed) ?? null;
  const primaryAction = getPrimaryAction(progress.nextStepId);

  return (
    <ControlPlanePanel
      title="Setup progress"
      description="Overview stays intentionally light. Use this panel to close the first-run path, then Open Requests for the operational feed once traffic starts flowing."
    >
      <div className="space-y-5">
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
          <div className="grid gap-4 md:grid-cols-[auto_minmax(0,1fr)]">
            <div className="rounded-2xl border border-[hsl(var(--border))] bg-card px-4 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[hsl(var(--muted))]">
                Completed
              </p>
              <p className="mt-2 text-3xl font-semibold tracking-tight text-[hsl(var(--foreground))]">
                {progress.completedStepCount}/{progress.totalStepCount}
              </p>
            </div>

            <div className="rounded-2xl border border-[hsl(var(--border))] bg-card px-4 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[hsl(var(--muted))]">
                Next action
              </p>
              <p className="mt-2 text-lg font-semibold text-[hsl(var(--foreground))]">
                {nextStep ? nextStep.title : "First-run closed"}
              </p>
              <p className="mt-2 text-sm leading-6 text-[hsl(var(--muted))]">
                {nextStep
                  ? nextStep.description
                  : "Provider, project, key, and first request are all backed by real persisted state."}
              </p>
            </div>
          </div>

          <div className="flex flex-col items-start gap-3 xl:items-end">
            <Link
              href={primaryAction.href}
              className="inline-flex items-center justify-center rounded-full border border-[hsl(var(--primary))] bg-[hsl(var(--primary))] px-4 py-2 text-sm font-semibold text-white"
            >
              {primaryAction.label}
            </Link>
            <p className="max-w-sm text-sm leading-6 text-[hsl(var(--muted))] xl:text-right">
              {primaryAction.helper}
            </p>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {progress.steps.map((step, index) => {
            const isNext = progress.nextStepId === step.id;
            const badge = getStepBadge(step, isNext);

            return (
              <article
                key={step.id}
                className={`rounded-2xl border p-4 ${getStepCardClasses({
                  step,
                  isNext,
                })}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[hsl(var(--border))] bg-white text-sm font-semibold text-[hsl(var(--foreground))]">
                    {index + 1}
                  </div>
                  <StatusBadge tone={badge.tone}>{badge.label}</StatusBadge>
                </div>
                <p className="mt-4 text-sm font-semibold text-[hsl(var(--foreground))]">
                  {step.title}
                </p>
                <p className="mt-2 text-sm leading-6 text-[hsl(var(--muted))]">
                  {step.description}
                </p>
              </article>
            );
          })}
        </div>

        <div className="rounded-2xl border border-[hsl(var(--border))] bg-card px-4 py-4 text-sm leading-6 text-[hsl(var(--muted))]">
          Requests remains the operational reading surface after traffic starts.
          If you need the feed now,{" "}
          <Link
            href="/requests"
            className="font-semibold text-[hsl(var(--foreground))] underline decoration-[hsl(var(--border))] underline-offset-4"
          >
            Open Requests
          </Link>
          .
        </div>
      </div>
    </ControlPlanePanel>
  );
}
