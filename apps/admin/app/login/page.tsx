import { redirect } from "next/navigation";

import { ControlPlanePanel } from "@/components/control-plane-panel";
import { hasValidAdminSession } from "@/lib/admin-access-gate";

import { submitAdminLogin } from "./actions";

export const dynamic = "force-dynamic";

interface LoginPageProps {
  searchParams?: Promise<{
    error?: string;
    notice?: string;
  }>;
}

function getLoginErrorMessage(errorCode: string | undefined) {
  switch (errorCode) {
    case "missing-password":
      return "Enter the shared admin password to open a temporary control-plane session.";
    case "invalid-password":
      return "Access denied. Use the current shared password configured for this workspace.";
    case "session-unavailable":
      return "The access gate could not create a signed session cookie. Retry the login flow.";
    case "rate-limited":
      return "Too many failed login attempts from this origin. Wait 10 minutes before retrying the shared password.";
    default:
      return null;
  }
}

function getLoginNoticeMessage(noticeCode: string | undefined) {
  switch (noticeCode) {
    case "logged-out":
      return "The admin session was cleared for this browser. Sign in again to reopen the control plane.";
    default:
      return null;
  }
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  if (await hasValidAdminSession()) {
    redirect("/");
  }

  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const errorMessage = getLoginErrorMessage(resolvedSearchParams?.error);
  const noticeMessage = getLoginNoticeMessage(resolvedSearchParams?.notice);

  return (
    <div className="min-h-screen px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto grid min-h-screen max-w-6xl items-center gap-6 lg:grid-cols-[minmax(0,1.1fr)_26rem]">
        <section className="rounded-[32px] border border-[hsl(var(--border))] bg-card p-6 shadow-sm sm:p-8">
          <div className="inline-flex rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--primary-soft))] px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-[hsl(var(--primary))]">
            Sprint 2
          </div>

          <div className="mt-6 space-y-4">
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-[hsl(var(--muted))]">
              Operational access gate
            </p>
            <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-[hsl(var(--foreground))]">
              Temporary admin login for a single workspace control plane.
            </h1>
            <p className="max-w-3xl text-base leading-7 text-[hsl(var(--muted))]">
              This gate is intentionally minimal. It uses one shared password
              and a signed browser session so Sprint 2 can protect the admin
              without turning the repo into a multi-user auth product.
            </p>
          </div>

          <div className="mt-8 grid gap-4 md:grid-cols-2">
            <article className="rounded-3xl border border-[hsl(var(--border))] bg-[hsl(var(--card-muted))] p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[hsl(var(--muted))]">
                What this is
              </p>
              <p className="mt-3 text-sm leading-6 text-[hsl(var(--muted))]">
                A temporary shared-secret gate for an internal admin surface,
                oriented to one workspace and one operator path.
              </p>
            </article>

            <article className="rounded-3xl border border-[hsl(var(--border))] bg-[hsl(var(--card-muted))] p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[hsl(var(--muted))]">
                What this is not
              </p>
              <p className="mt-3 text-sm leading-6 text-[hsl(var(--muted))]">
                No signup, no recovery flow, no user records, no roles, and no
                multi-workspace session model.
              </p>
            </article>
          </div>

          <div className="mt-4 rounded-3xl border border-dashed border-[hsl(var(--border))] p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[hsl(var(--muted))]">
              Session posture
            </p>
            <p className="mt-3 text-sm leading-6 text-[hsl(var(--muted))]">
              A successful login creates a signed, HTTP-only session cookie for
              this browser with a 12-hour lifetime. Failed password attempts are
              throttled per origin, and the gate now protects the whole admin
              route group without claiming to be full product auth.
            </p>
          </div>
        </section>

        <ControlPlanePanel
          title="Enter shared password"
          description="Use the current shared admin password to create a temporary signed session for this browser."
        >
          {noticeMessage ? (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm leading-6 text-emerald-700">
              {noticeMessage}
            </div>
          ) : null}

          {errorMessage ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-4 text-sm leading-6 text-rose-700">
              {errorMessage}
            </div>
          ) : null}

          <form action={submitAdminLogin} className="space-y-4">
            <div className="space-y-2">
              <label
                htmlFor="password"
                className="text-sm font-semibold text-[hsl(var(--foreground))]"
              >
                Shared admin password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                placeholder="Enter the shared password"
                className="w-full rounded-2xl border border-[hsl(var(--border))] bg-card px-4 py-3 text-sm text-[hsl(var(--foreground))]"
              />
            </div>

            <button
              type="submit"
              className="inline-flex items-center rounded-full border border-[hsl(var(--primary))] bg-[hsl(var(--primary))] px-4 py-2 text-sm font-semibold text-white"
            >
              Create signed session
            </button>
          </form>

          <p className="mt-4 text-xs leading-6 text-[hsl(var(--muted))]">
            This remains a transitory Sprint 2 access gate: one shared password,
            one browser session, one workspace-oriented control plane.
          </p>
        </ControlPlanePanel>
      </div>
    </div>
  );
}
