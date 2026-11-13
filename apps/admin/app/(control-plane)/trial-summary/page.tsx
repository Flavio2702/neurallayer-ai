import type { TrialSummaryHighlightItem } from "@neuralayer/db";
import Link from "next/link";

import { ControlPlanePanel } from "@/components/control-plane-panel";
import { StatusBadge } from "@/components/status-badge";
import { loadAdminTrialSummarySnapshot } from "@/lib/control-plane-data";
import {
  formatCompactNumber,
  formatCurrencyUsd,
  formatDateTime,
} from "@/lib/format";

type SearchParamValue = string | string[] | undefined;

interface TrialSummaryPageProps {
  searchParams?: Promise<{
    range?: SearchParamValue;
  }>;
}

function getSingleSearchParam(value: SearchParamValue) {
  return Array.isArray(value) ? value[0] : value;
}

function formatLabel(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/^\w/, (char) => char.toUpperCase());
}

function getStatusTone(status: TrialSummaryHighlightItem["status"]) {
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

function getProviderModelText(item: TrialSummaryHighlightItem) {
  if (item.provider || item.model) {
    return `${item.provider ? formatLabel(item.provider) : "No provider selected"} / ${
      item.model ?? "Model not recorded"
    }`;
  }

  return "No provider or model was selected for this request.";
}

function getHighlightMetadata(item: TrialSummaryHighlightItem) {
  const parts: string[] = [];

  if (typeof item.costTotalUsd === "number") {
    parts.push(`Cost ${formatCurrencyUsd(item.costTotalUsd)}`);
  }

  if (item.errorCode) {
    parts.push(`Error code ${item.errorCode}`);
  } else if (item.errorType) {
    parts.push(`Error type ${item.errorType}`);
  }

  return parts.join(" | ");
}

export default async function TrialSummaryPage({
  searchParams,
}: TrialSummaryPageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const snapshot = await loadAdminTrialSummarySnapshot({
    rangeParam: getSingleSearchParam(resolvedSearchParams?.range),
  });

  if (!snapshot.available) {
    return (
      <ControlPlanePanel
        title="Database state unavailable"
        description="Trial summary stays server-rendered and DB-backed; it does not replace missing workspace data with synthetic manager-facing placeholders."
      >
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-5 text-sm leading-6 text-rose-700">
          {snapshot.errorMessage}
        </div>
      </ControlPlanePanel>
    );
  }

  const { summary } = snapshot;
  const hasRequests = summary.totals.requestCount > 0;
  const requestsCsvHref = `/requests/export?range=${summary.window.range}`;
  const auditCsvHref = `/audit/export?range=${summary.window.range}`;
  const rangeHref = {
    "7d": "/trial-summary?range=7d",
    "30d": "/trial-summary?range=30d",
  } as const;

  return (
    <div className="mx-auto grid w-full max-w-4xl gap-6">
      <ControlPlanePanel
        title="Trial summary"
        description="Read a narrow, metadata-first view of the trial without opening the full request feed. This stays the clearest place to share pilot evidence and points back to Requests and Audit for deeper operational context."
      >
        <div className="space-y-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[hsl(var(--muted))]">
                Rolling window
              </p>
              <p className="text-sm leading-6 text-[hsl(var(--muted))]">
                {formatDateTime(summary.window.start)} to{" "}
                {formatDateTime(summary.window.end)}
              </p>
            </div>

            <div className="flex flex-col items-start gap-3 sm:items-end">
              <div className="inline-flex w-fit rounded-full border border-[hsl(var(--border))] bg-card p-1">
                {(["7d", "30d"] as const).map((range) => {
                  const isActive = summary.window.range === range;

                  return (
                    <Link
                      key={range}
                      href={rangeHref[range]}
                      aria-current={isActive ? "page" : undefined}
                      className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
                        isActive
                          ? "bg-[hsl(var(--primary))] text-white"
                          : "text-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]"
                      }`}
                    >
                      {range}
                    </Link>
                  );
                })}
              </div>

              <div className="flex flex-wrap justify-end gap-3">
                <Link
                  href={requestsCsvHref}
                  className="inline-flex items-center justify-center rounded-full border border-[hsl(var(--border))] bg-card px-4 py-2 text-sm font-semibold text-[hsl(var(--foreground))] transition-colors hover:border-[hsl(var(--foreground))]"
                >
                  Download Requests CSV
                </Link>
                <Link
                  href={auditCsvHref}
                  className="inline-flex items-center justify-center rounded-full border border-[hsl(var(--border))] bg-card px-4 py-2 text-sm font-semibold text-[hsl(var(--foreground))] transition-colors hover:border-[hsl(var(--foreground))]"
                >
                  Download Audit CSV
                </Link>
              </div>
            </div>
          </div>

          <p className="text-sm leading-6 text-[hsl(var(--muted))]">
            Use this page as the canonical place to share trial evidence for the
            current 7d or 30d rolling window. Both CSV exports stay
            metadata-first: Requests captures operational outcomes, while Audit
            captures the broader runtime and control-plane trail without prompt
            bodies, response bodies, secrets, or raw payload blobs.
          </p>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <article className="rounded-2xl border border-[hsl(var(--border))] bg-card p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[hsl(var(--muted))]">
                Requests
              </p>
              <p className="mt-2 text-2xl font-semibold tracking-tight text-[hsl(var(--foreground))]">
                {formatCompactNumber(summary.totals.requestCount)}
              </p>
            </article>

            <article className="rounded-2xl border border-[hsl(var(--border))] bg-card p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[hsl(var(--muted))]">
                Total cost
              </p>
              <p className="mt-2 text-2xl font-semibold tracking-tight text-[hsl(var(--foreground))]">
                {formatCurrencyUsd(summary.totals.totalCostUsd)}
              </p>
            </article>

            <article className="rounded-2xl border border-[hsl(var(--border))] bg-card p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[hsl(var(--muted))]">
                Succeeded
              </p>
              <p className="mt-2 text-2xl font-semibold tracking-tight text-emerald-700">
                {formatCompactNumber(summary.totals.succeededCount)}
              </p>
            </article>

            <article className="rounded-2xl border border-[hsl(var(--border))] bg-card p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[hsl(var(--muted))]">
                Blocked
              </p>
              <p className="mt-2 text-2xl font-semibold tracking-tight text-amber-700">
                {formatCompactNumber(summary.totals.blockedCount)}
              </p>
            </article>

            <article className="rounded-2xl border border-[hsl(var(--border))] bg-card p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[hsl(var(--muted))]">
                Failed
              </p>
              <p className="mt-2 text-2xl font-semibold tracking-tight text-rose-700">
                {formatCompactNumber(summary.totals.failedCount)}
              </p>
            </article>
          </div>

          {summary.totals.runningCount > 0 ? (
            <div className="rounded-2xl border border-[hsl(var(--border))] bg-card px-4 py-4 text-sm leading-6 text-[hsl(var(--muted))]">
              {formatCompactNumber(summary.totals.runningCount)} request
              {summary.totals.runningCount === 1 ? " is" : "s are"} still marked
              running in this window. Use Requests for the live operational
              feed.
            </div>
          ) : null}

          {!hasRequests ? (
            <div className="rounded-2xl border border-dashed border-[hsl(var(--border))] px-4 py-5 text-sm leading-6 text-[hsl(var(--muted))]">
              No requests fall inside this rolling window yet. The page stays
              grounded in real DB state, so there is nothing to summarize until
              the trial generates runtime traffic.
            </div>
          ) : null}
        </div>
      </ControlPlanePanel>

      <ControlPlanePanel
        title="By provider"
        description="Keep provider mix readable without turning the page into an analytics console."
      >
        {summary.providerBreakdown.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[hsl(var(--border))] px-4 py-5 text-sm leading-6 text-[hsl(var(--muted))]">
            No provider breakdown is available in the selected window.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[38rem] text-left text-sm">
              <thead>
                <tr className="border-b border-[hsl(var(--border))] text-xs uppercase tracking-[0.16em] text-[hsl(var(--muted))]">
                  <th className="px-3 py-3 font-semibold">Provider</th>
                  <th className="px-3 py-3 font-semibold">Requests</th>
                  <th className="px-3 py-3 font-semibold">Succeeded</th>
                  <th className="px-3 py-3 font-semibold">Blocked</th>
                  <th className="px-3 py-3 font-semibold">Failed</th>
                  <th className="px-3 py-3 font-semibold">Cost</th>
                </tr>
              </thead>
              <tbody>
                {summary.providerBreakdown.map((item) => (
                  <tr
                    key={item.provider}
                    className="border-b border-[hsl(var(--border))] last:border-b-0"
                  >
                    <td className="px-3 py-3 font-semibold text-[hsl(var(--foreground))]">
                      {item.label}
                    </td>
                    <td className="px-3 py-3 text-[hsl(var(--foreground))]">
                      {formatCompactNumber(item.requestCount)}
                    </td>
                    <td className="px-3 py-3 text-emerald-700">
                      {formatCompactNumber(item.succeededCount)}
                    </td>
                    <td className="px-3 py-3 text-amber-700">
                      {formatCompactNumber(item.blockedCount)}
                    </td>
                    <td className="px-3 py-3 text-rose-700">
                      {formatCompactNumber(item.failedCount)}
                    </td>
                    <td className="px-3 py-3 text-[hsl(var(--foreground))]">
                      {formatCurrencyUsd(item.totalCostUsd)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ControlPlanePanel>

      <ControlPlanePanel
        title="By mode"
        description="Read how the trial was actually used without reopening the request-by-request feed."
      >
        {summary.modeBreakdown.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[hsl(var(--border))] px-4 py-5 text-sm leading-6 text-[hsl(var(--muted))]">
            No mode breakdown is available in the selected window.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[38rem] text-left text-sm">
              <thead>
                <tr className="border-b border-[hsl(var(--border))] text-xs uppercase tracking-[0.16em] text-[hsl(var(--muted))]">
                  <th className="px-3 py-3 font-semibold">Mode</th>
                  <th className="px-3 py-3 font-semibold">Requests</th>
                  <th className="px-3 py-3 font-semibold">Succeeded</th>
                  <th className="px-3 py-3 font-semibold">Blocked</th>
                  <th className="px-3 py-3 font-semibold">Failed</th>
                  <th className="px-3 py-3 font-semibold">Cost</th>
                </tr>
              </thead>
              <tbody>
                {summary.modeBreakdown.map((item) => (
                  <tr
                    key={item.mode}
                    className="border-b border-[hsl(var(--border))] last:border-b-0"
                  >
                    <td className="px-3 py-3 font-semibold text-[hsl(var(--foreground))]">
                      {item.label}
                    </td>
                    <td className="px-3 py-3 text-[hsl(var(--foreground))]">
                      {formatCompactNumber(item.requestCount)}
                    </td>
                    <td className="px-3 py-3 text-emerald-700">
                      {formatCompactNumber(item.succeededCount)}
                    </td>
                    <td className="px-3 py-3 text-amber-700">
                      {formatCompactNumber(item.blockedCount)}
                    </td>
                    <td className="px-3 py-3 text-rose-700">
                      {formatCompactNumber(item.failedCount)}
                    </td>
                    <td className="px-3 py-3 text-[hsl(var(--foreground))]">
                      {formatCurrencyUsd(item.totalCostUsd)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ControlPlanePanel>

      <ControlPlanePanel
        title="Recent highlights"
        description="Keep only a few recent runtime outcomes visible here so the page stays readable and shareable."
      >
        {summary.highlights.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[hsl(var(--border))] px-4 py-5 text-sm leading-6 text-[hsl(var(--muted))]">
            No runtime highlights are available in the selected window yet.
          </div>
        ) : (
          <div className="space-y-3">
            {summary.highlights.map((item) => {
              const metadata = getHighlightMetadata(item);

              return (
                <article
                  key={`${item.requestId}-${item.timestamp}`}
                  className="rounded-2xl border border-[hsl(var(--border))] bg-card p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-[hsl(var(--foreground))]">
                        {item.project.name}
                      </p>
                      <p className="mt-1 text-xs uppercase tracking-[0.16em] text-[hsl(var(--muted))]">
                        {formatDateTime(item.timestamp)}
                      </p>
                    </div>
                    <StatusBadge tone={getStatusTone(item.status)}>
                      {formatLabel(item.status)}
                    </StatusBadge>
                  </div>

                  <p className="mt-3 text-sm leading-6 text-[hsl(var(--foreground))]">
                    {item.message ??
                      (item.status === "succeeded"
                        ? "Request completed successfully."
                        : item.status === "blocked"
                          ? "Request was blocked before provider execution."
                          : item.status === "failed"
                            ? "Request failed after routing selected a path."
                            : "Request is still running in the selected window.")}
                  </p>
                  <p className="mt-2 text-sm text-[hsl(var(--muted))]">
                    {formatLabel(item.mode)} mode | {getProviderModelText(item)}
                  </p>
                  {metadata ? (
                    <p className="mt-1 text-sm text-[hsl(var(--muted))]">
                      {metadata}
                    </p>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </ControlPlanePanel>

      <ControlPlanePanel
        title="Keep reading"
        description="Trial summary stays intentionally narrow. Use the dedicated operational pages when you need the live feed or broader runtime lineage."
      >
        <div className="flex flex-col gap-3 sm:flex-row">
          <Link
            href="/requests"
            className="inline-flex items-center justify-center rounded-full border border-[hsl(var(--primary))] bg-[hsl(var(--primary))] px-5 py-3 text-sm font-semibold text-white"
          >
            Open Requests
          </Link>
          <Link
            href="/audit"
            className="inline-flex items-center justify-center rounded-full border border-[hsl(var(--border))] bg-card px-5 py-3 text-sm font-semibold text-[hsl(var(--foreground))] transition-colors hover:border-[hsl(var(--foreground))]"
          >
            Open Audit
          </Link>
        </div>
        <p className="mt-4 text-sm leading-6 text-[hsl(var(--muted))]">
          Requests remains the operational feed for individual outcomes. Audit
          keeps the broader metadata-first trail for runtime and control-plane
          events.
        </p>
      </ControlPlanePanel>
    </div>
  );
}
