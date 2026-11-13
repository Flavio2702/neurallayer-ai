import { ControlPlanePanel } from "@/components/control-plane-panel";
import { StatusBadge } from "@/components/status-badge";
import { loadAdminAuditSnapshot } from "@/lib/control-plane-data";
import { formatCurrencyUsd, formatDateTime } from "@/lib/format";

function getRequestTone(status: string) {
  switch (status) {
    case "succeeded":
      return "success";
    case "blocked":
      return "warning";
    case "failed":
      return "danger";
    default:
      return "info";
  }
}

export default async function AuditPage() {
  const snapshot = await loadAdminAuditSnapshot();

  if (!snapshot.available) {
    return (
      <ControlPlanePanel
        title="Database state unavailable"
        description="Audit views stay grounded in persisted request and event rows; they do not substitute fake rows when the database is unavailable."
      >
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-5 text-sm leading-6 text-rose-700">
          {snapshot.errorMessage}
        </div>
      </ControlPlanePanel>
    );
  }

  return (
    <div className="grid gap-6">
      <ControlPlanePanel
        title="Recent request lineage"
        description="Each row is derived from the real request, latest attempt, usage, and routing audit records while keeping prompts and responses redacted."
      >
        <div className="space-y-3">
          {snapshot.recentRequests.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[hsl(var(--border))] px-4 py-5 text-sm text-[hsl(var(--muted))]">
              No request lineage is available yet.
            </div>
          ) : (
            snapshot.recentRequests.map((request) => (
              <article
                key={request.id}
                className="rounded-2xl border border-[hsl(var(--border))] bg-card p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-[hsl(var(--foreground))]">
                      {request.id}
                    </p>
                    <p className="mt-1 text-sm text-[hsl(var(--muted))]">
                      {request.project.name} • {request.mode} •{" "}
                      {request.taskType}
                    </p>
                  </div>
                  <StatusBadge tone={getRequestTone(request.status)}>
                    {request.status}
                  </StatusBadge>
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-3">
                  <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card-muted))] p-3 text-sm text-[hsl(var(--muted))]">
                    <p className="font-semibold text-[hsl(var(--foreground))]">
                      What happened
                    </p>
                    <p className="mt-2">
                      Provider:{" "}
                      {request.latestAttempt?.provider ??
                        request.routing.selectedProvider ??
                        "Unavailable"}
                    </p>
                    <p className="mt-1">
                      Model:{" "}
                      {request.latestAttempt?.modelId ??
                        request.routing.selectedModel ??
                        "Unavailable"}
                    </p>
                    <p className="mt-1">
                      Messages: {request.requestEnvelope.messageCount}
                    </p>
                  </div>

                  <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card-muted))] p-3 text-sm text-[hsl(var(--muted))]">
                    <p className="font-semibold text-[hsl(var(--foreground))]">
                      Why
                    </p>
                    <p className="mt-2">
                      {request.routing.selectionReasonText ??
                        request.outcome.message ??
                        "No routing explanation recorded."}
                    </p>
                    <p className="mt-1">
                      Error:{" "}
                      {request.latestAttempt?.errorCode ??
                        request.outcome.errorCode ??
                        "None"}
                    </p>
                  </div>

                  <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card-muted))] p-3 text-sm text-[hsl(var(--muted))]">
                    <p className="font-semibold text-[hsl(var(--foreground))]">
                      How much
                    </p>
                    <p className="mt-2">
                      Cost:{" "}
                      {formatCurrencyUsd(
                        request.usage?.costTotalUsd ??
                          request.outcome.costTotalUsd,
                      )}
                    </p>
                    <p className="mt-1">
                      Tokens: {request.usage?.totalTokens ?? "Unknown"}
                    </p>
                    <p className="mt-1">
                      Completed:{" "}
                      {formatDateTime(
                        request.completedAt ??
                          request.latestAttempt?.completedAt ??
                          request.startedAt,
                      )}
                    </p>
                  </div>
                </div>
              </article>
            ))
          )}
        </div>
      </ControlPlanePanel>

      <ControlPlanePanel
        title="Recent audit events"
        description="Audit remains metadata-only and favors explainable operational records over heavy analytics."
      >
        <div className="space-y-3">
          {snapshot.recentAuditEvents.map((event) => (
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
                    {event.project?.name ?? "Workspace scope"} •{" "}
                    {event.actorType}
                  </p>
                </div>
                <p className="text-xs uppercase tracking-[0.16em] text-[hsl(var(--muted))]">
                  {formatDateTime(event.createdAt)}
                </p>
              </div>

              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card-muted))] p-3 text-sm text-[hsl(var(--muted))]">
                  <p>
                    {event.message ?? `${event.entityType} ${event.entityId}`}
                  </p>
                  <p className="mt-1">
                    Request status: {event.requestStatus ?? "Unavailable"}
                  </p>
                </div>

                <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card-muted))] p-3 text-sm text-[hsl(var(--muted))]">
                  <p>Provider: {event.provider ?? "Unavailable"}</p>
                  <p className="mt-1">Model: {event.model ?? "Unavailable"}</p>
                  <p className="mt-1">
                    Cost: {formatCurrencyUsd(event.costTotalUsd)}
                  </p>
                </div>
              </div>
            </article>
          ))}
        </div>
      </ControlPlanePanel>
    </div>
  );
}
