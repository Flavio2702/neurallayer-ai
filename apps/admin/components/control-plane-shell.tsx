"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { controlPlaneRoutes, getControlPlaneRoute } from "@/lib/control-plane";

interface ControlPlaneShellProps {
  children: ReactNode;
  headerAction?: ReactNode;
}

export function ControlPlaneShell({
  children,
  headerAction,
}: ControlPlaneShellProps) {
  const pathname = usePathname();
  const currentRoute = getControlPlaneRoute(pathname);

  return (
    <div className="min-h-screen">
      <div className="mx-auto grid min-h-screen max-w-7xl gap-5 px-4 py-4 lg:grid-cols-[17rem_minmax(0,1fr)] lg:px-6 lg:py-6">
        <aside className="rounded-[28px] border border-[hsl(var(--border))] bg-card p-5 shadow-sm">
          <div className="space-y-3">
            <div className="inline-flex rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--primary-soft))] px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-[hsl(var(--primary))]">
              Sprint 3
            </div>
            <div className="space-y-2">
              <p className="text-xl font-semibold tracking-tight text-[hsl(var(--foreground))]">
                NeuralLayer Admin
              </p>
              <p className="text-sm leading-6 text-[hsl(var(--muted))]">
                Session-gated control plane for one workspace, focused on guided
                setup, a narrow manager-facing trial readout, and readable
                runtime visibility. Overview stays intentionally light; Trial
                summary explains the pilot at a glance; Requests remains the
                primary operational surface once traffic starts flowing.
              </p>
            </div>
          </div>

          <nav aria-label="Primary" className="mt-8">
            <ul className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible">
              {controlPlaneRoutes.map((route) => {
                const isActive =
                  route.href === "/"
                    ? pathname === route.href
                    : pathname === route.href ||
                      pathname?.startsWith(`${route.href}/`);

                return (
                  <li key={route.id} className="min-w-0 shrink-0 lg:shrink">
                    <Link
                      href={route.href}
                      aria-current={isActive ? "page" : undefined}
                      className={`flex min-w-[9rem] flex-col rounded-2xl border px-4 py-3 transition-colors lg:min-w-0 ${
                        isActive
                          ? "border-[hsl(var(--primary))] bg-[hsl(var(--primary-soft))] text-[hsl(var(--foreground))]"
                          : "border-[hsl(var(--border))] bg-transparent text-[hsl(var(--muted))] hover:border-[hsl(var(--foreground))] hover:text-[hsl(var(--foreground))]"
                      }`}
                    >
                      <span className="text-sm font-semibold">
                        {route.title}
                      </span>
                      <span className="mt-1 text-xs leading-5">
                        {route.description}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>

          <div className="mt-8 rounded-3xl border border-[hsl(var(--border))] bg-[hsl(var(--card-muted))] p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[hsl(var(--muted))]">
              Runtime focus
            </p>
            <p className="mt-3 text-sm leading-6 text-[hsl(var(--muted))]">
              Use Trial summary to share a tight readout of the pilot,
              Playground for one-shot verification, and Requests as the main
              runtime view. Overview only tracks month-to-date posture plus
              compact blocked and audit context.
            </p>
          </div>

          <div className="mt-8 rounded-3xl border border-dashed border-[hsl(var(--border))] p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[hsl(var(--muted))]">
              Access gate posture
            </p>
            <p className="mt-3 text-sm leading-6 text-[hsl(var(--muted))]">
              Temporary shared-password gate with signed browser session and
              basic login throttling. No multi-user auth product, no full CRUD,
              and no control-plane scope creep.
            </p>
          </div>
        </aside>

        <div className="flex min-w-0 flex-col gap-5">
          <header className="rounded-[28px] border border-[hsl(var(--border))] bg-card px-6 py-5 shadow-sm sm:px-7">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[hsl(var(--muted))]">
                  Control plane
                </p>
                <div className="space-y-2">
                  <h1 className="text-3xl font-semibold tracking-tight text-[hsl(var(--foreground))]">
                    {currentRoute.title}
                  </h1>
                  <p className="max-w-3xl text-sm leading-6 text-[hsl(var(--muted))]">
                    {currentRoute.description}
                  </p>
                </div>
              </div>

              <div className="flex flex-col items-start gap-3 sm:items-end">
                <div className="inline-flex items-center rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--card-muted))] px-3 py-2 text-xs font-medium uppercase tracking-[0.16em] text-[hsl(var(--muted))]">
                  Session-gated real DB state
                </div>
                {headerAction}
              </div>
            </div>
          </header>

          <main className="flex-1 rounded-[28px] border border-[hsl(var(--border))] bg-card p-5 shadow-sm sm:p-7">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
