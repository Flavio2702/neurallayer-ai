import { ControlPlanePanel } from "@/components/control-plane-panel";
import { SetupProgressPanel } from "@/components/setup-progress-panel";
import { StatusBadge } from "@/components/status-badge";
import { loadAdminOverviewSnapshot } from "@/lib/control-plane-data";
import {
  formatCompactNumber,
  formatCurrencyUsd,
  formatDateTime,
} from "@/lib/format";

function getAuditTone(eventType: string) {
  switch (eventType) {
    case "chat.completions.completed":
      return "success";
    case "chat.completions.blocked":
      return "warning";
    case "chat.completions.failed":
      return "danger";
    default:
      return "info";
  }
}

export default async function OverviewPage() {
  const snapshot = await loadAdminOverviewSnapshot();

  if (!snapshot.available) {
    return (
      <ControlPlanePanel
        title="Database state unavailable"
        description="The admin remains server-rendered and DB-backed; it does not fall back to static placeholders when the data source is unavailable."
      >
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-5 text-sm leading-6 text-rose-700">
          {snapshot.errorMessage}
        </div>
      </ControlPlanePanel>
    );
  }

  const activeProviderCount = snapshot.providers.filter(
    (provider) => provider.account?.status === "active",
  ).length;

  return (
    <div className="grid gap-6">
      <SetupProgressPanel progress={snapshot.setupProgress} />

      <div className="grid gap-4 xl:grid-cols-4">
        <article className="rounded-3xl border border-[hsl(var(--border))] bg-[hsl(var(--card-muted))] p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[hsl(var(--muted))]">
            Requests MTD
          </p>
          <p className="mt-3 text-2xl font-semibold tracking-tight text-[hsl(var(--foreground))]">
            {formatCompactNumber(snapshot.stats.requestCount)}
          </p>
          <p className="mt-2 text-sm text-[hsl(var(--muted))]">
            Month-to-date request volume across the current workspace.
          </p>
        </article>

        <article className="rounded-3xl border border-[hsl(var(--border))] bg-[hsl(var(--card-muted))] p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[hsl(var(--muted))]">
            Cost MTD
          </p>
          <p className="mt-3 text-2xl font-semibold tracking-tight text-[hsl(var(--foreground))]">
            {formatCurrencyUsd(snapshot.stats.totalCostUsd)}
          </p>
          <p className="mt-2 text-sm text-[hsl(var(--muted))]">
            Based on persisted usage records, not forecast analytics.
          </p>
        </article>

        <article className="rounded-3xl border border-[hsl(var(--border))] bg-[hsl(var(--card-muted))] p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[hsl(var(--muted))]">
            Blocked MTD
          </p>
          <p className="mt-3 text-2xl font-semibold tracking-tight text-[hsl(var(--foreground))]">
            {formatCompactNumber(snapshot.stats.blockedCount)}
          </p>
          <p className="mt-2 text-sm text-[hsl(var(--muted))]">
            Requests stopped before provider execution this month.
          </p>
        </article>

        <article className="rounded-3xl border border-[hsl(var(--border))] bg-[hsl(var(--card-muted))] p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[hsl(var(--muted))]">
            Active providers
          </p>
          <p className="mt-3 text-2xl font-semibold tracking-tight text-[hsl(var(--foreground))]">
            {formatCompactNumber(activeProviderCount)}
          </p>
          <p className="mt-2 text-sm text-[hsl(var(--muted))]">
            Derived from provider account status. Readiness details stay in
            Providers.
          </p>
        </article>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <ControlPlanePanel
          title="Recent blocked"
          description="Keep the latest blocked traffic visible here, then use Requests for full runtime context and filtering."
        >
          <div className="space-y-3">
            {snapshot.blockedRecent.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-[hsl(var(--border))] px-4 py-5 text-sm leading-6 text-[hsl(var(--muted))]">
                No recent blocked requests have been recorded.
              </div>
            ) : (
              snapshot.blockedRecent.map((item) => (
                <article
                  key={`${item.requestId}-${item.timestamp}`}
                  className="rounded-2xl border border-[hsl(var(--border))] bg-card p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-[hsl(var(--foreground))]">
                        {item.project.name}
                      </p>
                      <p className="mt-1 text-xs uppercase tracking-[0.16em] text-[hsl(var(--muted))]">
                        {formatDateTime(item.timestamp)}
                      </p>
                    </div>
                    <StatusBadge tone="warning">Blocked</StatusBadge>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-[hsl(var(--foreground))]">
                    {item.reason.text ??
                      "This request was blocked before a provider call started."}
                  </p>
                  <p className="mt-2 text-sm text-[hsl(var(--muted))]">
                    {item.mode
                      ? `${item.mode.replaceAll("_", " ")} mode`
                      : "Mode not recorded"}
                  </p>
                  {item.reason.code ? (
                    <p className="mt-1 font-mono text-xs text-[hsl(var(--muted))]">
                      {item.reason.code}
                    </p>
                  ) : null}
                </article>
              ))
            )}
          </div>
        </ControlPlanePanel>

        <ControlPlanePanel
          title="Recent audit"
          description="Audit stays metadata-first and lightweight here. Use the dedicated pages when you need the broader operational story."
        >
          <div className="space-y-3">
            {snapshot.recentAuditEvents.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-[hsl(var(--border))] px-4 py-5 text-sm leading-6 text-[hsl(var(--muted))]">
                No recent audit events are available yet.
              </div>
            ) : (
              snapshot.recentAuditEvents.map((event) => (
                <article
                  key={event.id}
                  className="rounded-2xl border border-[hsl(var(--border))] bg-card p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-[hsl(var(--foreground))]">
                        {event.eventType}
                      </p>
                      <p className="mt-1 text-sm text-[hsl(var(--muted))]">
                        {event.project?.name ?? "Workspace scope"}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge tone={getAuditTone(event.eventType)}>
                        {event.requestStatus ?? "audit"}
                      </StatusBadge>
                      <p className="text-xs uppercase tracking-[0.16em] text-[hsl(var(--muted))]">
                        {formatDateTime(event.createdAt)}
                      </p>
                    </div>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-[hsl(var(--foreground))]">
                    {event.message ?? `${event.entityType} ${event.entityId}`}
                  </p>
                </article>
              ))
            )}
          </div>
        </ControlPlanePanel>
      </div>
    </div>
  );
}
