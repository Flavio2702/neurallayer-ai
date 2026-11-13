import { loadAdminConfig } from "@neuralayer/config";
import { listProjects, resolveDefaultAdminWorkspace } from "@neuralayer/db";
import Link from "next/link";
import { ControlPlanePanel } from "@/components/control-plane-panel";
import { PlaygroundRequestForm } from "@/components/playground-request-form";

type PlaygroundSnapshot =
  | {
      available: false;
      errorMessage: string;
    }
  | {
      available: true;
      workspaceContext: NonNullable<
        Awaited<ReturnType<typeof resolveDefaultAdminWorkspace>>
      >;
      activeProjects: Awaited<ReturnType<typeof listProjects>>;
    };

async function loadPlaygroundSnapshot(): Promise<PlaygroundSnapshot> {
  try {
    const workspaceContext = await resolveDefaultAdminWorkspace();

    if (!workspaceContext) {
      return {
        available: false,
        errorMessage:
          "No active workspace is available in the configured database.",
      };
    }

    const projects = await listProjects(workspaceContext.workspace.id);
    const activeProjects = projects.filter(
      (project) => project.status === "active",
    );

    return {
      available: true,
      workspaceContext,
      activeProjects,
    };
  } catch (error) {
    return {
      available: false,
      errorMessage:
        error instanceof Error
          ? error.message
          : "The Playground page could not load database-backed state.",
    };
  }
}

export default async function PlaygroundPage() {
  const snapshot = await loadPlaygroundSnapshot();

  if (!snapshot.available) {
    return (
      <ControlPlanePanel
        title="Database state unavailable"
        description="Playground stays session-gated and DB-backed for workspace/project context; it does not fake project choices when the real state is unavailable."
      >
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-5 text-sm leading-6 text-rose-700">
          {snapshot.errorMessage}
        </div>
      </ControlPlanePanel>
    );
  }

  if (snapshot.activeProjects.length === 0) {
    return (
      <ControlPlanePanel
        title="No active projects"
        description="Playground only works with active, real projects because it sends a real one-shot request through the gateway path."
      >
        <div className="space-y-4 rounded-2xl border border-dashed border-[hsl(var(--border))] bg-card p-5 text-sm leading-6 text-[hsl(var(--muted))]">
          <p>
            Create or reactivate a project in Projects before using Playground.
            The page intentionally refuses to invent a fake project context.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/projects"
              className="inline-flex items-center rounded-full border border-[hsl(var(--primary))] bg-[hsl(var(--primary))] px-4 py-2 font-semibold text-white"
            >
              Open Projects
            </Link>
            <Link
              href="/requests"
              className="inline-flex items-center rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--card-muted))] px-4 py-2 font-semibold text-[hsl(var(--foreground))] transition-colors hover:border-[hsl(var(--foreground))]"
            >
              Open Requests
            </Link>
          </div>
        </div>
      </ControlPlanePanel>
    );
  }

  const defaultProject =
    snapshot.activeProjects.find(
      (project) => project.id === snapshot.workspaceContext.project?.id,
    ) ?? snapshot.activeProjects[0];

  if (!defaultProject) {
    return (
      <ControlPlanePanel
        title="No active projects"
        description="Playground only works with active, real projects because it sends a real one-shot request through the gateway path."
      >
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-5 text-sm leading-6 text-rose-700">
          Playground could not resolve a default active project from the current
          workspace.
        </div>
      </ControlPlanePanel>
    );
  }

  const {
    public: { gatewayUrl },
  } = loadAdminConfig();

  return (
    <div className="grid gap-6">
      <div className="rounded-[28px] border border-[hsl(var(--border))] bg-[hsl(var(--card-muted))] p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-3xl space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[hsl(var(--muted))]">
              One-shot runtime check
            </p>
            <p className="text-lg font-semibold tracking-tight text-[hsl(var(--foreground))]">
              Prepare one real request here, keep the auth model explicit, then
              use Requests to read persisted runtime context.
            </p>
          </div>

          <Link
            href="/requests"
            className="inline-flex items-center justify-center rounded-full border border-[hsl(var(--primary))] bg-[hsl(var(--primary))] px-4 py-2 text-sm font-semibold text-white"
          >
            Open Requests
          </Link>
        </div>
      </div>

      <ControlPlanePanel
        title="Playground form"
        description="This page stays intentionally small: pick one active project, choose one mode, enter one request, and send it through the real gateway path."
      >
        <PlaygroundRequestForm
          projects={snapshot.activeProjects.map((project) => ({
            id: project.id,
            name: project.name,
            slug: project.slug,
          }))}
          defaultProjectId={defaultProject.id}
          defaultMode={snapshot.workspaceContext.workspace.defaultMode}
          gatewayUrl={gatewayUrl}
        />
      </ControlPlanePanel>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <ControlPlanePanel
          title="Auth strategy"
          description="Playground does not recover or mint keys for you. The partner pastes the raw project key explicitly and the admin uses it only for request-scoped pass-through."
        >
          <div className="space-y-3 text-sm leading-6 text-[hsl(var(--muted))]">
            <div className="rounded-2xl border border-[hsl(var(--border))] bg-card p-4">
              <p className="font-semibold text-[hsl(var(--foreground))]">
                Why the key is explicit
              </p>
              <p className="mt-2">
                Project API keys are raw-once by design, so Playground asks for
                the raw key directly instead of creating a hidden server-side
                bypass around key recovery.
              </p>
            </div>
            <div className="rounded-2xl border border-[hsl(var(--border))] bg-card p-4">
              <p className="font-semibold text-[hsl(var(--foreground))]">
                What stays transient
              </p>
              <p className="mt-2">
                The admin forwards the pasted key only to `/v1/me` and
                `/v1/chat/completions`. It does not persist the key or create
                extra server-side playground state.
              </p>
            </div>
            <div className="rounded-2xl border border-[hsl(var(--border))] bg-card p-4">
              <p className="font-semibold text-[hsl(var(--foreground))]">
                Browser-tab convenience
              </p>
              <p className="mt-2">
                The visible toggle can keep raw keys only in the current tab via
                `sessionStorage`; turning it off clears every retained
                Playground key in that tab, and closing the tab removes the
                remaining session state.
              </p>
            </div>
          </div>
        </ControlPlanePanel>

        <ControlPlanePanel
          title="Operational boundaries"
          description="Keep Playground useful for setup and demo without turning it into a second runtime console."
        >
          <div className="space-y-3 text-sm leading-6 text-[hsl(var(--muted))]">
            <div className="rounded-2xl border border-[hsl(var(--border))] bg-card p-4">
              <p className="font-semibold text-[hsl(var(--foreground))]">
                Gateway target
              </p>
              <p className="mt-2 font-mono text-xs text-[hsl(var(--foreground))]">
                {gatewayUrl}
              </p>
            </div>
            <div className="rounded-2xl border border-[hsl(var(--border))] bg-card p-4">
              <p className="font-semibold text-[hsl(var(--foreground))]">
                What this page does not do
              </p>
              <p className="mt-2">
                No history, no chat transcript, no provider override, no hidden
                server-side session for raw keys, and no shortcut around the
                real gateway semantics.
              </p>
            </div>
            <div className="rounded-2xl border border-[hsl(var(--border))] bg-card p-4">
              <p className="font-semibold text-[hsl(var(--foreground))]">
                After traffic starts
              </p>
              <p className="mt-2">
                Use Playground to send the one-shot request, then move back to{" "}
                <Link
                  href="/requests"
                  className="font-semibold text-[hsl(var(--foreground))] underline decoration-[hsl(var(--border))] underline-offset-4"
                >
                  Requests
                </Link>{" "}
                for the operational reading surface.
              </p>
            </div>
          </div>
        </ControlPlanePanel>
      </div>
    </div>
  );
}
