import type { RequestStatus } from "@neuralayer/core";
import {
  getRequestsPageData,
  listProjects,
  MANUAL_REQUEST_FEEDBACK_VALUES,
  MAX_MANUAL_REQUEST_FEEDBACK_NOTE_LENGTH,
  type ManualRequestFeedbackValue,
  resolveDefaultAdminWorkspace,
} from "@neuralayer/db";
import Link from "next/link";

import { ControlPlanePanel } from "@/components/control-plane-panel";
import { StatusBadge } from "@/components/status-badge";
import {
  formatCompactNumber,
  formatCurrencyUsd,
  formatDateTime,
} from "@/lib/format";

import { recordManualRequestFeedback } from "./actions";

const REQUEST_STATUS_FILTER_VALUES = [
  "running",
  "succeeded",
  "failed",
  "blocked",
] as const;

type SearchParamValue = string | string[] | undefined;
type RequestsStatusFilterValue = (typeof REQUEST_STATUS_FILTER_VALUES)[number];
type RequestsFeedbackNoticeValue = "feedback_saved";
type RequestsPageSnapshot =
  | {
      available: false;
      errorMessage: string;
    }
  | {
      available: true;
      workspaceContext: NonNullable<
        Awaited<ReturnType<typeof resolveDefaultAdminWorkspace>>
      >;
      projects: Awaited<ReturnType<typeof listProjects>>;
      pageData: Awaited<ReturnType<typeof getRequestsPageData>>;
      selectedProjectId: string | null;
      selectedStatus: RequestsStatusFilterValue | null;
    };

interface RequestsPageProps {
  searchParams?: Promise<{
    project?: SearchParamValue;
    status?: SearchParamValue;
    feedbackRequest?: SearchParamValue;
    feedbackNotice?: SearchParamValue;
    feedbackError?: SearchParamValue;
  }>;
}

function getSingleSearchParam(value: SearchParamValue) {
  return Array.isArray(value) ? value[0] : value;
}

function normalizeFilterParam(value: string | undefined) {
  if (!value || value === "all") {
    return undefined;
  }

  return value;
}

function isRequestsStatusFilterValue(
  value: string | null | undefined,
): value is RequestsStatusFilterValue {
  return REQUEST_STATUS_FILTER_VALUES.includes(
    value as RequestsStatusFilterValue,
  );
}

function formatLabel(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/^\w/, (char) => char.toUpperCase());
}

function getRequestCardAnchorId(requestId: string) {
  return `request-${requestId}`;
}

function getRequestStatusTone(status: RequestStatus) {
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

function getAuditTone(eventType: string) {
  switch (eventType) {
    case "chat.completions.completed":
      return "success";
    case "chat.completions.blocked":
      return "warning";
    default:
      return "danger";
  }
}

function getAuditLabel(eventType: string) {
  switch (eventType) {
    case "chat.completions.completed":
      return "Completed";
    case "chat.completions.blocked":
      return "Blocked";
    case "chat.completions.failed":
      return "Failed";
    default:
      return "Runtime event";
  }
}

function isRequestsFeedbackNoticeValue(
  value: string | null | undefined,
): value is RequestsFeedbackNoticeValue {
  return value === "feedback_saved";
}

function getProviderLabel(provider: string | null) {
  switch (provider) {
    case "openai":
      return "OpenAI";
    case "anthropic":
      return "Anthropic";
    default:
      return provider ? formatLabel(provider) : "No provider selected";
  }
}

function formatLatency(latencyMs: number | null) {
  if (typeof latencyMs !== "number" || !Number.isFinite(latencyMs)) {
    return "Not recorded yet";
  }

  if (latencyMs >= 1000) {
    const seconds = latencyMs / 1000;

    return `${seconds.toFixed(seconds % 1 === 0 ? 0 : 1)} s`;
  }

  return `${latencyMs} ms`;
}

function formatUsageSummary(
  input: {
    totalTokens: number | null;
    inputTokens: number | null;
    outputTokens: number | null;
  } | null,
) {
  if (!input) {
    return "Not recorded yet";
  }

  if (typeof input.totalTokens === "number") {
    return `${formatCompactNumber(input.totalTokens)} total tokens`;
  }

  if (
    typeof input.inputTokens === "number" &&
    typeof input.outputTokens === "number"
  ) {
    return `${formatCompactNumber(input.inputTokens)} in / ${formatCompactNumber(
      input.outputTokens,
    )} out`;
  }

  if (typeof input.inputTokens === "number") {
    return `${formatCompactNumber(input.inputTokens)} input tokens`;
  }

  if (typeof input.outputTokens === "number") {
    return `${formatCompactNumber(input.outputTokens)} output tokens`;
  }

  return "Not recorded yet";
}

function formatCostSummary(input: { totalUsd: number | null } | null) {
  return typeof input?.totalUsd === "number"
    ? formatCurrencyUsd(input.totalUsd)
    : "Not recorded yet";
}

function getManualFeedbackTone(value: ManualRequestFeedbackValue) {
  switch (value) {
    case "useful":
      return "success";
    case "needs_follow_up":
      return "warning";
    case "not_useful":
      return "danger";
    default:
      return "neutral";
  }
}

function getManualFeedbackLabel(value: ManualRequestFeedbackValue) {
  switch (value) {
    case "needs_follow_up":
      return "Needs follow-up";
    case "not_useful":
      return "Not useful";
    case "useful":
      return "Useful";
    default:
      return formatLabel(value);
  }
}

function getInlineFeedbackNoticeClasses(tone: "success" | "danger") {
  return tone === "success"
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : "border-rose-200 bg-rose-50 text-rose-700";
}

function getFeedbackFlashState(input: {
  requestId?: string;
  notice?: string;
  error?: string;
}) {
  const requestId = input.requestId?.trim();

  if (!requestId) {
    return null;
  }

  if (isRequestsFeedbackNoticeValue(input.notice)) {
    return {
      requestId,
      tone: "success",
      message:
        "Saved manual outcome feedback for this request. It stays metadata-first and does not affect routing.",
    } as const;
  }

  if (input.error) {
    return {
      requestId,
      tone: "danger",
      message: input.error,
    } as const;
  }

  return null;
}

function getSelectionReasonText(input: {
  selectionReason: { text: string | null };
  status: RequestStatus;
  issue: { kind: "blocked" | "error"; text: string | null } | null;
}) {
  if (input.selectionReason.text) {
    return input.selectionReason.text;
  }

  if (input.status === "blocked") {
    return (
      input.issue?.text ??
      "This request was stopped before provider execution started."
    );
  }

  if (input.status === "failed") {
    return (
      input.issue?.text ??
      "The provider path failed after a routing decision was made."
    );
  }

  return "No routing explanation was recorded for this request.";
}

function getIssueSummary(input: {
  issue: {
    kind: "blocked" | "error";
    code: string | null;
    type: string | null;
    text: string | null;
  };
}) {
  const fallbackText =
    input.issue.kind === "blocked"
      ? "This request was blocked before a provider call started."
      : "Provider execution failed after routing selected a path.";

  const metadata = [input.issue.code, input.issue.type]
    .filter((value): value is string => Boolean(value))
    .join(" / ");

  return {
    text: input.issue.text ?? fallbackText,
    metadata,
    toneClass:
      input.issue.kind === "blocked"
        ? "border-amber-200 bg-amber-50 text-amber-800"
        : "border-rose-200 bg-rose-50 text-rose-800",
  };
}

function getRequestExplanationClasses(input: {
  status: RequestStatus;
  issueSummary: ReturnType<typeof getIssueSummary> | null;
}) {
  if (input.issueSummary) {
    return input.issueSummary.toneClass;
  }

  switch (input.status) {
    case "succeeded":
      return "border-emerald-200 bg-emerald-50 text-emerald-900";
    case "running":
      return "border-sky-200 bg-sky-50 text-sky-900";
    case "blocked":
      return "border-amber-200 bg-amber-50 text-amber-800";
    case "failed":
      return "border-rose-200 bg-rose-50 text-rose-800";
    default:
      return "border-[hsl(var(--border))] bg-[hsl(var(--card-muted))] text-[hsl(var(--foreground))]";
  }
}

function getBlockedReasonText(input: { text: string | null }) {
  return input.text ?? "Blocked before a provider was selected for execution.";
}

async function loadRequestsPageSnapshot(input: {
  projectParam?: string;
  statusParam?: string;
}): Promise<RequestsPageSnapshot> {
  try {
    const workspaceContext = await resolveDefaultAdminWorkspace();

    if (!workspaceContext) {
      return {
        available: false,
        errorMessage:
          "No active workspace is available in the configured database.",
      };
    }

    const selectedStatus = isRequestsStatusFilterValue(input.statusParam)
      ? input.statusParam
      : null;
    const projectsPromise = listProjects(workspaceContext.workspace.id);
    const tentativePageDataPromise = getRequestsPageData({
      workspaceId: workspaceContext.workspace.id,
      projectId: input.projectParam,
      status: selectedStatus ?? undefined,
    });
    const [projects, tentativePageData] = await Promise.all([
      projectsPromise,
      tentativePageDataPromise,
    ]);
    const selectedProjectId =
      input.projectParam &&
      projects.some((project) => project.id === input.projectParam)
        ? input.projectParam
        : null;
    const pageData =
      input.projectParam && !selectedProjectId
        ? await getRequestsPageData({
            workspaceId: workspaceContext.workspace.id,
            status: selectedStatus ?? undefined,
          })
        : tentativePageData;

    return {
      available: true,
      workspaceContext,
      projects,
      pageData,
      selectedProjectId,
      selectedStatus,
    };
  } catch (error) {
    return {
      available: false,
      errorMessage:
        error instanceof Error
          ? error.message
          : "The Requests page could not load database-backed state.",
    };
  }
}

export default async function RequestsPage({
  searchParams,
}: RequestsPageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const rawProjectParam = normalizeFilterParam(
    getSingleSearchParam(resolvedSearchParams?.project),
  );
  const rawStatusParam = normalizeFilterParam(
    getSingleSearchParam(resolvedSearchParams?.status),
  );
  const feedbackFlashState = getFeedbackFlashState({
    requestId: getSingleSearchParam(resolvedSearchParams?.feedbackRequest),
    notice: getSingleSearchParam(resolvedSearchParams?.feedbackNotice),
    error: getSingleSearchParam(resolvedSearchParams?.feedbackError),
  });
  const snapshot = await loadRequestsPageSnapshot({
    projectParam: rawProjectParam,
    statusParam: rawStatusParam,
  });

  if (!snapshot.available) {
    return (
      <ControlPlanePanel
        title="Database state unavailable"
        description="Requests stays server-rendered and DB-backed; it does not substitute static placeholders when the underlying request lineage cannot be read."
      >
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-5 text-sm leading-6 text-rose-700">
          {snapshot.errorMessage}
        </div>
      </ControlPlanePanel>
    );
  }

  const hasFilters =
    snapshot.selectedProjectId !== null || snapshot.selectedStatus !== null;
  const selectedProject =
    snapshot.projects.find(
      (project) => project.id === snapshot.selectedProjectId,
    ) ?? null;
  const requestsCsvHref = "/requests/export?range=30d";
  const trialSummaryHref = "/trial-summary";
  const emptyFeedMessage = hasFilters
    ? `No requests match the current filters${
        selectedProject ? ` for ${selectedProject.name}` : ""
      }. Try all statuses or another project.`
    : "No requests have been recorded for this workspace yet. Send a real request and come back here to read the outcome.";

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,0.65fr)]">
      <div className="grid gap-6">
        <ControlPlanePanel
          title="Operational request feed"
          description="Read what actually happened for each request without opening logs. The feed stays metadata-first, keeps prompts and responses redacted, and makes successes, blocks, and failures easy to explain."
        >
          <div className="space-y-5">
            <form
              action="/requests"
              method="get"
              className="rounded-2xl border border-[hsl(var(--border))] bg-card p-4"
            >
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                <div className="space-y-2">
                  <label
                    htmlFor="requests-project-filter"
                    className="text-sm font-semibold text-[hsl(var(--foreground))]"
                  >
                    Project
                  </label>
                  <select
                    id="requests-project-filter"
                    name="project"
                    defaultValue={snapshot.selectedProjectId ?? "all"}
                    className="w-full rounded-2xl border border-[hsl(var(--border))] bg-card px-4 py-3 text-sm text-[hsl(var(--foreground))]"
                  >
                    <option value="all">All projects</option>
                    {snapshot.projects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <label
                    htmlFor="requests-status-filter"
                    className="text-sm font-semibold text-[hsl(var(--foreground))]"
                  >
                    Status
                  </label>
                  <select
                    id="requests-status-filter"
                    name="status"
                    defaultValue={snapshot.selectedStatus ?? "all"}
                    className="w-full rounded-2xl border border-[hsl(var(--border))] bg-card px-4 py-3 text-sm text-[hsl(var(--foreground))]"
                  >
                    <option value="all">All statuses</option>
                    {REQUEST_STATUS_FILTER_VALUES.map((status) => (
                      <option key={status} value={status}>
                        {formatLabel(status)}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-wrap items-end gap-3">
                  <button
                    type="submit"
                    className="inline-flex items-center rounded-full border border-[hsl(var(--primary))] bg-[hsl(var(--primary))] px-4 py-2 text-sm font-semibold text-white"
                  >
                    Apply
                  </button>
                  <Link
                    href="/requests"
                    className="inline-flex items-center rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--card-muted))] px-4 py-2 text-sm font-semibold text-[hsl(var(--foreground))] transition-colors hover:border-[hsl(var(--foreground))]"
                  >
                    Reset
                  </Link>
                </div>
              </div>

              <p className="mt-3 text-sm leading-6 text-[hsl(var(--muted))]">
                Project narrows the full page. Status only refines the main
                feed, so blocked and audit context stay visible while you
                inspect a single request outcome.
              </p>

              <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--card-muted))] px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
                <p className="text-sm leading-6 text-[hsl(var(--muted))]">
                  Need a shareable export? Use Trial summary as the primary
                  sharing surface for rolling 7d/30d and paired Audit export.
                  This page keeps a quick 30d Requests CSV close by without
                  turning the feed into a reporting center.
                </p>

                <div className="flex flex-wrap gap-2 lg:justify-end">
                  <Link
                    href={trialSummaryHref}
                    className="inline-flex items-center rounded-full border border-[hsl(var(--border))] bg-transparent px-3 py-2 text-sm font-semibold text-[hsl(var(--foreground))] transition-colors hover:border-[hsl(var(--foreground))]"
                  >
                    Open Trial summary
                  </Link>
                  <Link
                    href={requestsCsvHref}
                    className="inline-flex items-center rounded-full border border-[hsl(var(--border))] bg-card px-3 py-2 text-sm font-semibold text-[hsl(var(--foreground))] transition-colors hover:border-[hsl(var(--foreground))]"
                  >
                    Quick 30d Requests CSV
                  </Link>
                </div>
              </div>
            </form>

            <div className="space-y-3">
              {snapshot.pageData.feed.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-[hsl(var(--border))] px-4 py-6 text-sm leading-6 text-[hsl(var(--muted))]">
                  {emptyFeedMessage}
                </div>
              ) : (
                snapshot.pageData.feed.map((item) => {
                  const issueSummary = item.issue
                    ? getIssueSummary({ issue: item.issue })
                    : null;
                  const selectionReasonText = getSelectionReasonText({
                    selectionReason: item.selectionReason,
                    status: item.status,
                    issue: item.issue,
                  });
                  const secondaryReasonText =
                    issueSummary && selectionReasonText !== issueSummary.text
                      ? selectionReasonText
                      : null;
                  const isFeedbackTarget =
                    feedbackFlashState?.requestId === item.requestId;
                  const feedbackDisclosureOpen =
                    isFeedbackTarget && feedbackFlashState?.tone === "danger";

                  return (
                    <article
                      key={item.requestId}
                      id={getRequestCardAnchorId(item.requestId)}
                      className="rounded-2xl border border-[hsl(var(--border))] bg-card p-4"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-[hsl(var(--foreground))]">
                            {item.project.name}
                          </p>
                          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-[hsl(var(--muted))]">
                            <span>
                              {item.project.slug ?? "No project slug recorded"}
                            </span>
                            <span aria-hidden="true">/</span>
                            <span className="font-mono text-xs">
                              {item.requestId}
                            </span>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center justify-end gap-2">
                          <p className="text-xs uppercase tracking-[0.16em] text-[hsl(var(--muted))]">
                            {formatDateTime(item.timestamp)}
                          </p>
                          <StatusBadge tone={getRequestStatusTone(item.status)}>
                            {formatLabel(item.status)}
                          </StatusBadge>
                        </div>
                      </div>

                      <div
                        className={`mt-4 rounded-2xl border px-4 py-4 text-sm leading-6 ${getRequestExplanationClasses(
                          {
                            status: item.status,
                            issueSummary,
                          },
                        )}`}
                      >
                        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[hsl(var(--muted))]">
                          Why this happened
                        </p>
                        <p className="mt-2 font-semibold">
                          {issueSummary?.text ?? selectionReasonText}
                        </p>
                        {secondaryReasonText ? (
                          <p className="mt-2 text-sm leading-6">
                            {secondaryReasonText}
                          </p>
                        ) : null}
                        {issueSummary?.metadata ? (
                          <p className="mt-2 text-xs uppercase tracking-[0.14em]">
                            {issueSummary.metadata}
                          </p>
                        ) : null}
                      </div>

                      <div className="mt-4 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card-muted))] p-4">
                        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[hsl(var(--muted))]">
                          Request detail
                        </p>
                        <dl className="mt-3 grid gap-x-4 gap-y-3 sm:grid-cols-2 xl:grid-cols-3">
                          <div>
                            <dt className="text-xs font-semibold uppercase tracking-[0.16em] text-[hsl(var(--muted))]">
                              Mode
                            </dt>
                            <dd className="mt-1 text-sm text-[hsl(var(--foreground))]">
                              {formatLabel(item.mode)}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-xs font-semibold uppercase tracking-[0.16em] text-[hsl(var(--muted))]">
                              Provider
                            </dt>
                            <dd className="mt-1 text-sm text-[hsl(var(--foreground))]">
                              {getProviderLabel(item.provider)}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-xs font-semibold uppercase tracking-[0.16em] text-[hsl(var(--muted))]">
                              Model
                            </dt>
                            <dd className="mt-1 break-all text-sm text-[hsl(var(--foreground))]">
                              {item.model ?? "No provider selected"}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-xs font-semibold uppercase tracking-[0.16em] text-[hsl(var(--muted))]">
                              Latency
                            </dt>
                            <dd className="mt-1 text-sm text-[hsl(var(--foreground))]">
                              {formatLatency(item.latencyMs)}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-xs font-semibold uppercase tracking-[0.16em] text-[hsl(var(--muted))]">
                              Usage
                            </dt>
                            <dd className="mt-1 text-sm text-[hsl(var(--foreground))]">
                              {formatUsageSummary(item.usage)}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-xs font-semibold uppercase tracking-[0.16em] text-[hsl(var(--muted))]">
                              Cost
                            </dt>
                            <dd className="mt-1 text-sm text-[hsl(var(--foreground))]">
                              {formatCostSummary(item.cost)}
                            </dd>
                          </div>
                        </dl>
                      </div>

                      <div className="mt-4 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card-muted))] p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="space-y-2">
                            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[hsl(var(--muted))]">
                              Outcome feedback
                            </p>
                            <p className="text-sm leading-6 text-[hsl(var(--muted))]">
                              Use this only for a lightweight pilot signal on
                              the request itself. It does not change routing,
                              policy, or the runtime status above.
                            </p>
                          </div>

                          {item.manualFeedback ? (
                            <StatusBadge
                              tone={getManualFeedbackTone(
                                item.manualFeedback.value,
                              )}
                            >
                              {getManualFeedbackLabel(
                                item.manualFeedback.value,
                              )}
                            </StatusBadge>
                          ) : (
                            <span className="inline-flex items-center rounded-full border border-[hsl(var(--border))] px-3 py-1 text-xs font-medium uppercase tracking-[0.14em] text-[hsl(var(--muted))]">
                              Not set
                            </span>
                          )}
                        </div>

                        <div className="mt-3 rounded-2xl border border-[hsl(var(--border))] bg-card px-4 py-3">
                          {item.manualFeedback ? (
                            <div className="space-y-2">
                              <p className="text-sm font-semibold text-[hsl(var(--foreground))]">
                                {getManualFeedbackLabel(
                                  item.manualFeedback.value,
                                )}
                              </p>
                              <p className="text-sm text-[hsl(var(--muted))]">
                                Saved{" "}
                                {formatDateTime(item.manualFeedback.recordedAt)}
                              </p>
                              {item.manualFeedback.note ? (
                                <p className="text-sm leading-6 text-[hsl(var(--foreground))]">
                                  {item.manualFeedback.note}
                                </p>
                              ) : (
                                <p className="text-sm text-[hsl(var(--muted))]">
                                  No note recorded for this feedback yet.
                                </p>
                              )}
                            </div>
                          ) : (
                            <p className="text-sm text-[hsl(var(--muted))]">
                              No manual outcome feedback has been recorded yet
                              for this request.
                            </p>
                          )}
                        </div>

                        {isFeedbackTarget && feedbackFlashState ? (
                          <div
                            className={`mt-3 rounded-2xl border px-4 py-3 text-sm leading-6 ${getInlineFeedbackNoticeClasses(
                              feedbackFlashState.tone,
                            )}`}
                          >
                            {feedbackFlashState.message}
                          </div>
                        ) : null}

                        <details
                          open={feedbackDisclosureOpen}
                          className="mt-3 rounded-2xl border border-dashed border-[hsl(var(--border))] bg-card"
                        >
                          <summary className="flex cursor-pointer list-none items-start justify-between gap-3 px-4 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--primary))] focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--card))] [&::-webkit-details-marker]:hidden">
                            <div>
                              <p className="text-sm font-semibold text-[hsl(var(--foreground))]">
                                {item.manualFeedback
                                  ? "Edit feedback"
                                  : "Add feedback"}
                              </p>
                              <p className="mt-1 text-sm leading-6 text-[hsl(var(--muted))]">
                                Reveal the small pilot-only form only when you
                                need to record or revise the latest signal.
                              </p>
                            </div>

                            <span className="inline-flex items-center rounded-full border border-[hsl(var(--border))] px-3 py-1 text-xs font-medium uppercase tracking-[0.14em] text-[hsl(var(--muted))]">
                              {item.manualFeedback ? "Edit" : "Add"}
                            </span>
                          </summary>

                          <form
                            action={recordManualRequestFeedback}
                            className="space-y-3 border-t border-dashed border-[hsl(var(--border))] p-4"
                          >
                            <input
                              type="hidden"
                              name="workspaceId"
                              value={snapshot.workspaceContext.workspace.id}
                            />
                            <input
                              type="hidden"
                              name="requestId"
                              value={item.requestId}
                            />
                            <input
                              type="hidden"
                              name="returnProjectId"
                              value={snapshot.selectedProjectId ?? ""}
                            />
                            <input
                              type="hidden"
                              name="returnStatus"
                              value={snapshot.selectedStatus ?? ""}
                            />

                            <div className="grid gap-3 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)_auto] xl:items-end">
                              <div className="space-y-2">
                                <label
                                  htmlFor={`request-feedback-value-${item.requestId}`}
                                  className="text-sm font-semibold text-[hsl(var(--foreground))]"
                                >
                                  Outcome
                                </label>
                                <select
                                  id={`request-feedback-value-${item.requestId}`}
                                  name="value"
                                  required
                                  defaultValue={
                                    item.manualFeedback?.value ?? ""
                                  }
                                  className="w-full rounded-2xl border border-[hsl(var(--border))] bg-card px-4 py-3 text-sm text-[hsl(var(--foreground))]"
                                >
                                  <option value="" disabled>
                                    Select outcome
                                  </option>
                                  {MANUAL_REQUEST_FEEDBACK_VALUES.map(
                                    (value) => (
                                      <option key={value} value={value}>
                                        {getManualFeedbackLabel(value)}
                                      </option>
                                    ),
                                  )}
                                </select>
                              </div>

                              <div className="space-y-2">
                                <label
                                  htmlFor={`request-feedback-note-${item.requestId}`}
                                  className="text-sm font-semibold text-[hsl(var(--foreground))]"
                                >
                                  Optional note
                                </label>
                                <input
                                  id={`request-feedback-note-${item.requestId}`}
                                  name="note"
                                  type="text"
                                  maxLength={
                                    MAX_MANUAL_REQUEST_FEEDBACK_NOTE_LENGTH
                                  }
                                  defaultValue={item.manualFeedback?.note ?? ""}
                                  placeholder="Only if the extra context is genuinely useful..."
                                  className="w-full rounded-2xl border border-[hsl(var(--border))] bg-card px-4 py-3 text-sm text-[hsl(var(--foreground))]"
                                />
                              </div>

                              <button
                                type="submit"
                                className="inline-flex items-center rounded-full border border-[hsl(var(--primary))] bg-[hsl(var(--primary))] px-4 py-2 text-sm font-semibold text-white"
                              >
                                Save feedback
                              </button>
                            </div>

                            <p className="text-sm leading-6 text-[hsl(var(--muted))]">
                              Keep the note short and optional. Only the latest
                              manual feedback stays visible on this card.
                            </p>
                          </form>
                        </details>
                      </div>
                    </article>
                  );
                })
              )}
            </div>
          </div>
        </ControlPlanePanel>
      </div>

      <div className="grid content-start gap-6">
        <ControlPlanePanel
          title="Recent blocked"
          description="Recent blocked traffic stays visible as secondary context without taking focus away from the main request list."
        >
          <div className="space-y-3">
            {snapshot.pageData.blockedRecent.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-[hsl(var(--border))] px-4 py-5 text-sm leading-6 text-[hsl(var(--muted))]">
                No recent blocked requests match the current project scope.
              </div>
            ) : (
              snapshot.pageData.blockedRecent.map((item) => (
                <article
                  key={`${item.requestId}-${item.timestamp}`}
                  className="rounded-2xl border border-[hsl(var(--border))] bg-card p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-[hsl(var(--foreground))]">
                      {item.project.name}
                    </p>
                    <StatusBadge tone="warning">Blocked</StatusBadge>
                  </div>
                  <p className="mt-1 text-xs uppercase tracking-[0.16em] text-[hsl(var(--muted))]">
                    {formatDateTime(item.timestamp)}
                  </p>
                  <p className="mt-3 text-sm leading-6 text-[hsl(var(--foreground))]">
                    {getBlockedReasonText(item.reason)}
                  </p>
                  <p className="mt-2 text-sm text-[hsl(var(--muted))]">
                    {item.mode
                      ? `${formatLabel(item.mode)} mode`
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
          title="Recent runtime audit"
          description="This compact feed keeps the broader runtime trail nearby when you need to confirm a block, failure, or completion around the selected project scope."
        >
          <div className="space-y-3">
            {snapshot.pageData.recentAudit.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-[hsl(var(--border))] px-4 py-5 text-sm leading-6 text-[hsl(var(--muted))]">
                No recent runtime audit events match the current project scope.
              </div>
            ) : (
              snapshot.pageData.recentAudit.map((item) => (
                <article
                  key={`${item.requestId}-${item.timestamp}-${item.eventType}`}
                  className="rounded-2xl border border-[hsl(var(--border))] bg-card p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-[hsl(var(--foreground))]">
                      {item.project.name}
                    </p>
                    <StatusBadge tone={getAuditTone(item.eventType)}>
                      {getAuditLabel(item.eventType)}
                    </StatusBadge>
                  </div>
                  <p className="mt-1 text-xs uppercase tracking-[0.16em] text-[hsl(var(--muted))]">
                    {formatDateTime(item.timestamp)}
                  </p>
                  <p className="mt-3 text-sm leading-6 text-[hsl(var(--foreground))]">
                    {item.message ??
                      (item.eventType === "chat.completions.completed"
                        ? "Request completed successfully."
                        : item.eventType === "chat.completions.blocked"
                          ? "Request was blocked before provider execution."
                          : "Request failed during provider execution.")}
                  </p>
                  <p className="mt-2 text-sm text-[hsl(var(--muted))]">
                    {item.provider || item.model
                      ? `${getProviderLabel(item.provider)} / ${item.model ?? "Model not recorded"}`
                      : "Provider and model were not recorded for this event."}
                  </p>
                  <p className="mt-1 text-sm text-[hsl(var(--muted))]">
                    {typeof item.costTotalUsd === "number"
                      ? `Cost ${formatCurrencyUsd(item.costTotalUsd)}`
                      : item.errorCode
                        ? `Error code ${item.errorCode}`
                        : item.errorType
                          ? `Error type ${item.errorType}`
                          : "No extra runtime detail recorded."}
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
