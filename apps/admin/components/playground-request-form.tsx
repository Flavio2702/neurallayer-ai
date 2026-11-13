"use client";

import {
  type GatewaySuccessResponse,
  type Message,
  MODE_VALUES,
  type Mode,
} from "@neuralayer/core";
import Link from "next/link";
import {
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
  useEffect,
  useState,
  useTransition,
} from "react";

import { submitPlaygroundRequest } from "@/app/(control-plane)/playground/actions";
import { formatCompactNumber, formatCurrencyUsd } from "@/lib/format";
import {
  buildGatewayChatCompletionsCurlSnippet,
  PROJECT_GATEWAY_API_KEY_PLACEHOLDER,
} from "@/lib/gateway-curl-snippet";
import {
  initialPlaygroundFormState,
  type PlaygroundFormState,
} from "@/lib/playground-form-state";

const PLAYGROUND_PROJECT_KEY_STORAGE_PREFIX = "nl.playground.project-key.";

interface PlaygroundProjectOption {
  id: string;
  name: string;
  slug: string;
}

interface PlaygroundRequestFormProps {
  projects: PlaygroundProjectOption[];
  defaultProjectId: string;
  defaultMode: Mode;
  gatewayUrl: string;
}

interface PlaygroundSubmittedDraft {
  projectId: string;
  projectName: string;
  mode: Mode;
  messages: Message[];
  curlApiKey: string;
  usesPlaceholderApiKey: boolean;
}

function getStorageKey(projectId: string) {
  return `${PLAYGROUND_PROJECT_KEY_STORAGE_PREFIX}${projectId}`;
}

function loadStoredProjectKey(projectId: string) {
  return sessionStorage.getItem(getStorageKey(projectId)) ?? "";
}

function persistStoredProjectKey(projectId: string, rawKey: string) {
  const normalizedRawKey = rawKey.trim();

  if (normalizedRawKey.length === 0) {
    sessionStorage.removeItem(getStorageKey(projectId));
    return;
  }

  sessionStorage.setItem(getStorageKey(projectId), normalizedRawKey);
}

function clearStoredProjectKey(projectId: string) {
  sessionStorage.removeItem(getStorageKey(projectId));
}

function clearAllStoredProjectKeys() {
  const storageKeysToRemove: string[] = [];

  for (let index = 0; index < sessionStorage.length; index += 1) {
    const storageKey = sessionStorage.key(index);

    if (storageKey?.startsWith(PLAYGROUND_PROJECT_KEY_STORAGE_PREFIX)) {
      storageKeysToRemove.push(storageKey);
    }
  }

  for (const storageKey of storageKeysToRemove) {
    sessionStorage.removeItem(storageKey);
  }
}

function getStageLabel(stage: PlaygroundFormState["gatewayStage"]) {
  if (stage === "me") {
    return "GET /v1/me";
  }

  if (stage === "chat_completions") {
    return "POST /v1/chat/completions";
  }

  return null;
}

function formatLabel(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/^\w/, (char) => char.toUpperCase());
}

function getProviderLabel(provider: string) {
  switch (provider) {
    case "openai":
      return "OpenAI";
    case "anthropic":
      return "Anthropic";
    default:
      return formatLabel(provider);
  }
}

function formatLatency(latencyMs: number | null | undefined) {
  if (typeof latencyMs !== "number" || !Number.isFinite(latencyMs)) {
    return "Not returned";
  }

  if (latencyMs >= 1000) {
    const seconds = latencyMs / 1000;

    return `${seconds.toFixed(seconds % 1 === 0 ? 0 : 1)} s`;
  }

  return `${latencyMs} ms`;
}

function formatUsageSummary(usage: GatewaySuccessResponse["usage"]) {
  if (!usage) {
    return "Not returned";
  }

  if (typeof usage.total_tokens === "number") {
    return `${formatCompactNumber(usage.total_tokens)} total tokens`;
  }

  if (
    typeof usage.input_tokens === "number" &&
    typeof usage.output_tokens === "number"
  ) {
    return `${formatCompactNumber(usage.input_tokens)} in / ${formatCompactNumber(
      usage.output_tokens,
    )} out`;
  }

  if (typeof usage.input_tokens === "number") {
    return `${formatCompactNumber(usage.input_tokens)} input tokens`;
  }

  if (typeof usage.output_tokens === "number") {
    return `${formatCompactNumber(usage.output_tokens)} output tokens`;
  }

  return "Not returned";
}

function formatCostSource(
  value: GatewaySuccessResponse["meta"]["cost_source"],
) {
  if (!value) {
    return null;
  }

  return value === "provider_reported" ? "Provider reported" : "Estimated";
}

function buildSubmittedMessages(input: {
  systemPrompt: string;
  userPrompt: string;
}): Message[] {
  const systemPrompt = input.systemPrompt.trim();
  const userPrompt = input.userPrompt.trim();

  return [
    ...(systemPrompt.length > 0
      ? [
          {
            role: "system" as const,
            content: systemPrompt,
          },
        ]
      : []),
    ...(userPrompt.length > 0
      ? [
          {
            role: "user" as const,
            content: userPrompt,
          },
        ]
      : []),
  ];
}

function buildSubmittedDraft(input: {
  selectedProject: PlaygroundProjectOption | null;
  defaultMode: Mode;
  formData: FormData;
  rawProjectApiKey: string;
  keepKeyInTab: boolean;
}) {
  if (!input.selectedProject) {
    return null;
  }

  const modeValue = String(input.formData.get("mode") ?? "").trim();
  const normalizedApiKey = input.rawProjectApiKey.trim();
  const mode = MODE_VALUES.includes(modeValue as Mode)
    ? (modeValue as Mode)
    : input.defaultMode;
  const usesRetainedApiKey = input.keepKeyInTab && normalizedApiKey.length > 0;

  return {
    projectId: input.selectedProject.id,
    projectName: input.selectedProject.name,
    mode,
    messages: buildSubmittedMessages({
      systemPrompt: String(input.formData.get("systemPrompt") ?? ""),
      userPrompt: String(input.formData.get("userPrompt") ?? ""),
    }),
    curlApiKey: usesRetainedApiKey
      ? normalizedApiKey
      : PROJECT_GATEWAY_API_KEY_PLACEHOLDER,
    usesPlaceholderApiKey: !usesRetainedApiKey,
  } satisfies PlaygroundSubmittedDraft;
}

function NoticeCard(input: {
  tone: "warning" | "danger" | "info";
  title: string;
  children: ReactNode;
}) {
  const toneClass =
    input.tone === "danger"
      ? "border-rose-200 bg-rose-50 text-rose-800"
      : input.tone === "warning"
        ? "border-amber-200 bg-amber-50 text-amber-800"
        : "border-[hsl(var(--border))] bg-card text-[hsl(var(--foreground))]";

  return (
    <div
      className={`rounded-2xl border px-4 py-4 text-sm leading-6 ${toneClass}`}
    >
      <p className="font-semibold">{input.title}</p>
      <div className="mt-2">{input.children}</div>
    </div>
  );
}

function StatusNotice({ state }: { state: PlaygroundFormState }) {
  if (state.status === "validation_error" && state.message) {
    return (
      <NoticeCard
        tone="warning"
        title="Playground validation stopped this submit"
      >
        <p>{state.message}</p>
      </NoticeCard>
    );
  }

  if (state.status === "transport_error" && state.message) {
    const stageLabel = getStageLabel(state.gatewayStage);

    return (
      <NoticeCard
        tone="danger"
        title="Playground could not complete the gateway round-trip"
      >
        <p>{state.message}</p>
        {stageLabel ? <p className="mt-2">Stage: {stageLabel}</p> : null}
      </NoticeCard>
    );
  }

  return null;
}

function ResultMetadataItem(input: {
  label: string;
  value: string;
  hint?: string | null;
}) {
  return (
    <div className="rounded-2xl border border-[hsl(var(--border))] bg-card p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[hsl(var(--muted))]">
        {input.label}
      </p>
      <p className="mt-2 text-sm font-semibold leading-6 text-[hsl(var(--foreground))]">
        {input.value}
      </p>
      {input.hint ? (
        <p className="mt-1 text-xs leading-5 text-[hsl(var(--muted))]">
          {input.hint}
        </p>
      ) : null}
    </div>
  );
}

function GatewaySuccessRenderer({
  response,
}: {
  response: GatewaySuccessResponse;
}) {
  const assistantText =
    response.choices[0]?.message.content.trim() ||
    "The provider returned no assistant text for this one-shot request.";
  const selectionReason =
    response.meta.selection_reason?.text ??
    "No selection reason was returned for this outcome.";
  const costSource = formatCostSource(response.meta.cost_source);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm leading-6 text-emerald-800">
        <p className="font-semibold">Gateway returned a one-shot response.</p>
        <p className="mt-2">
          Request id: <span className="font-mono">{response.id}</span>
        </p>
      </div>

      <div className="rounded-2xl border border-[hsl(var(--border))] bg-card p-4">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[hsl(var(--muted))]">
          Assistant response
        </p>
        <pre className="mt-3 whitespace-pre-wrap break-words font-sans text-sm leading-6 text-[hsl(var(--foreground))]">
          {assistantText}
        </pre>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <ResultMetadataItem
          label="Provider"
          value={getProviderLabel(response.provider)}
        />
        <ResultMetadataItem label="Model" value={response.model} />
        <ResultMetadataItem
          label="Latency"
          value={formatLatency(response.meta.latency_ms)}
        />
        <ResultMetadataItem
          label="Usage"
          value={formatUsageSummary(response.usage)}
        />
        <ResultMetadataItem
          label="Cost"
          value={
            typeof response.meta.cost_usd === "number"
              ? formatCurrencyUsd(response.meta.cost_usd)
              : "Not returned"
          }
          hint={costSource ? `Source: ${costSource}` : null}
        />
        <ResultMetadataItem
          label="Mode"
          value={formatLabel(response.mode)}
          hint={`Task type: ${formatLabel(response.task_type)}`}
        />
      </div>

      <div className="rounded-2xl border border-[hsl(var(--border))] bg-card p-4">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[hsl(var(--muted))]">
          Selection reason
        </p>
        <p className="mt-2 text-sm leading-6 text-[hsl(var(--foreground))]">
          {selectionReason}
        </p>
      </div>

      {response.meta.warnings && response.meta.warnings.length > 0 ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm leading-6 text-amber-800">
          <p className="font-semibold">Routing warnings</p>
          <div className="mt-2 space-y-2">
            {response.meta.warnings.map((warning) => (
              <div key={`${warning.code}-${warning.message}`}>
                <p className="font-medium">{warning.code}</p>
                <p>{warning.message}</p>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function GatewayErrorRenderer({ state }: { state: PlaygroundFormState }) {
  if (state.status !== "gateway_error") {
    return null;
  }

  const stageLabel = getStageLabel(state.gatewayStage);

  return (
    <div className="space-y-4">
      <NoticeCard tone="danger" title="Structured gateway error">
        <p>{state.gatewayError.error.message}</p>
      </NoticeCard>

      <div className="grid gap-3 sm:grid-cols-2">
        <ResultMetadataItem
          label="Stage"
          value={stageLabel ?? "Gateway"}
          hint={state.message}
        />
        <ResultMetadataItem
          label="Error type"
          value={formatLabel(state.gatewayError.error.type)}
        />
        <ResultMetadataItem
          label="Error code"
          value={state.gatewayError.error.code}
        />
        <ResultMetadataItem
          label="Request id"
          value={state.gatewayError.error.request_id ?? "Not returned"}
        />
      </div>
    </div>
  );
}

function PlaygroundAttemptPanel(input: {
  draft: PlaygroundSubmittedDraft;
  state: PlaygroundFormState;
  gatewayUrl: string;
  pending: boolean;
  copiedCurl: boolean;
  onCopyCurl: (value: string) => Promise<void>;
}) {
  const curlSnippet = buildGatewayChatCompletionsCurlSnippet({
    apiKey: input.draft.curlApiKey,
    gatewayUrl: input.gatewayUrl,
    projectId: input.draft.projectId,
    mode: input.draft.mode,
    messages: input.draft.messages,
  });

  return (
    <article className="rounded-2xl border border-[hsl(var(--border))] bg-card p-4 text-sm text-[hsl(var(--muted))]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-[hsl(var(--foreground))]">
            Latest one-shot attempt
          </p>
          <p className="mt-2 leading-6">
            Playground keeps only the latest submit in view. Use it to confirm
            the immediate outcome, then move to Requests for persisted runtime
            context.
          </p>
        </div>
        <div className="rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--card-muted))] px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-[hsl(var(--foreground))]">
          {input.draft.projectName} - {formatLabel(input.draft.mode)}
        </div>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
        <div className="space-y-4">
          {input.pending ? (
            <NoticeCard tone="info" title="Sending one-shot request">
              <p>
                Playground is calling the real gateway path now. This panel will
                be replaced by the latest response or structured error when the
                round-trip completes.
              </p>
            </NoticeCard>
          ) : input.state.status === "gateway_success" ? (
            <GatewaySuccessRenderer response={input.state.gatewayResponse} />
          ) : input.state.status === "gateway_error" ? (
            <GatewayErrorRenderer state={input.state} />
          ) : (
            <StatusNotice state={input.state} />
          )}
        </div>

        <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--foreground))] px-4 py-4 text-sm text-slate-100">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-300">
                Copyable curl
              </p>
              <p className="mt-2 leading-6 text-slate-300">
                Playground and this snippet both call the same real{" "}
                <span className="font-mono">POST /v1/chat/completions</span>{" "}
                path with an explicit{" "}
                <span className="font-mono">project_id</span>.
              </p>
            </div>

            <button
              type="button"
              onClick={() => input.onCopyCurl(curlSnippet)}
              className="inline-flex items-center rounded-full border border-slate-600 bg-slate-800 px-4 py-2 text-sm font-semibold text-slate-100"
            >
              {input.copiedCurl ? "Curl copied" : "Copy curl"}
            </button>
          </div>

          <div className="mt-4 space-y-3">
            <div className="rounded-2xl border border-slate-700 bg-slate-900/60 px-4 py-4 text-sm leading-6 text-slate-200">
              {input.draft.usesPlaceholderApiKey ? (
                <p>
                  This snippet uses the safe placeholder{" "}
                  <span className="font-mono">
                    {PROJECT_GATEWAY_API_KEY_PLACEHOLDER}
                  </span>{" "}
                  because this tab is not retaining the raw key for the latest
                  submit.
                </p>
              ) : (
                <p>
                  This snippet still uses the same raw project key currently
                  kept in this tab for the latest submit.
                </p>
              )}
            </div>

            <pre className="overflow-x-auto whitespace-pre-wrap break-words leading-6 text-slate-100">
              {curlSnippet}
            </pre>
          </div>

          <div className="mt-4 rounded-2xl border border-slate-700 bg-slate-900/60 px-4 py-4 text-sm leading-6 text-slate-300">
            <p>
              After a real request starts creating runtime history, move to{" "}
              <Link
                href="/requests"
                className="font-semibold text-white underline decoration-slate-500 underline-offset-4"
              >
                Requests
              </Link>{" "}
              for the persisted operational view.
            </p>
          </div>
        </div>
      </div>
    </article>
  );
}

function PlaygroundSubmitButton(input: {
  disabled: boolean;
  pending: boolean;
}) {
  const disabled = input.disabled || input.pending;

  return (
    <button
      type="submit"
      disabled={disabled}
      className={`inline-flex items-center rounded-full px-4 py-2 text-sm font-semibold ${
        disabled
          ? "cursor-not-allowed border border-[hsl(var(--border))] bg-[hsl(var(--card-muted))] text-[hsl(var(--muted))]"
          : "border border-[hsl(var(--primary))] bg-[hsl(var(--primary))] text-white"
      }`}
    >
      {input.pending ? "Sending one-shot request..." : "Send one-shot request"}
    </button>
  );
}

export function PlaygroundRequestForm({
  projects,
  defaultProjectId,
  defaultMode,
  gatewayUrl,
}: PlaygroundRequestFormProps) {
  const [state, setState] = useState(initialPlaygroundFormState);
  const [lastSubmittedDraft, setLastSubmittedDraft] =
    useState<PlaygroundSubmittedDraft | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState(defaultProjectId);
  const [rawProjectApiKey, setRawProjectApiKey] = useState("");
  const [keepKeyInTab, setKeepKeyInTab] = useState(true);
  const [hydrated, setHydrated] = useState(false);
  const [copiedCurl, setCopiedCurl] = useState(false);
  const [isPending, startTransition] = useTransition();
  const selectedProject =
    projects.find((project) => project.id === selectedProjectId) ??
    projects[0] ??
    null;

  useEffect(() => {
    setHydrated(true);
    setRawProjectApiKey(loadStoredProjectKey(defaultProjectId));
  }, [defaultProjectId]);

  useEffect(() => {
    if (!hydrated || !keepKeyInTab) {
      return;
    }

    persistStoredProjectKey(selectedProjectId, rawProjectApiKey);
  }, [hydrated, keepKeyInTab, rawProjectApiKey, selectedProjectId]);

  function handleProjectChange(event: ChangeEvent<HTMLSelectElement>) {
    const nextProjectId = event.target.value;
    setSelectedProjectId(nextProjectId);

    if (hydrated && keepKeyInTab) {
      setRawProjectApiKey(loadStoredProjectKey(nextProjectId));
      return;
    }

    setRawProjectApiKey("");
  }

  function handleKeepKeyInTabChange(event: ChangeEvent<HTMLInputElement>) {
    const nextChecked = event.target.checked;
    setKeepKeyInTab(nextChecked);

    if (!nextChecked && hydrated) {
      clearAllStoredProjectKeys();
    }
  }

  function clearCurrentProjectKey() {
    setRawProjectApiKey("");

    if (hydrated) {
      clearStoredProjectKey(selectedProjectId);
    }
  }

  async function handleCopyCurl(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedCurl(true);
    } catch {
      setCopiedCurl(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const form = event.currentTarget;
    const formData = new FormData(form);
    formData.set("projectId", selectedProjectId);
    formData.set("rawProjectApiKey", rawProjectApiKey);

    setCopiedCurl(false);
    setState(initialPlaygroundFormState);
    setLastSubmittedDraft(
      buildSubmittedDraft({
        selectedProject,
        defaultMode,
        formData,
        rawProjectApiKey,
        keepKeyInTab,
      }),
    );

    startTransition(async () => {
      const nextState = await submitPlaygroundRequest(formData);
      setState(nextState);

      if (!keepKeyInTab) {
        setRawProjectApiKey("");
      }
    });
  }

  return (
    <div className="space-y-4">
      <article className="rounded-2xl border border-[hsl(var(--border))] bg-card p-4 text-sm text-[hsl(var(--muted))]">
        <div data-playground-ready={hydrated ? "true" : "false"} />

        <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card-muted))] px-4 py-4">
          <p className="font-semibold text-[hsl(var(--foreground))]">
            One request, one response path
          </p>
          <p className="mt-2 leading-6">
            Playground stays intentionally narrow: one request, no chat history,
            no transcript memory, no hidden key recovery. The pasted raw project
            key is validated through the real gateway{" "}
            <span className="font-mono">/v1/me</span> path before the one-shot
            request is forwarded to{" "}
            <span className="font-mono">/v1/chat/completions</span>.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.7fr)]">
            <div className="space-y-2">
              <label
                htmlFor="playground-project"
                className="text-sm font-semibold text-[hsl(var(--foreground))]"
              >
                Project
              </label>
              <select
                id="playground-project"
                name="projectId"
                value={selectedProjectId}
                onChange={handleProjectChange}
                className="w-full rounded-2xl border border-[hsl(var(--border))] bg-card px-4 py-3 text-sm text-[hsl(var(--foreground))]"
              >
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
              {selectedProject ? (
                <p className="text-sm leading-6">
                  Raw key management stays on{" "}
                  <Link
                    href={`/projects/${encodeURIComponent(selectedProject.slug)}`}
                    className="font-semibold text-[hsl(var(--foreground))] underline decoration-[hsl(var(--border))] underline-offset-4"
                  >
                    this project detail
                  </Link>
                  .
                </p>
              ) : null}
            </div>

            <div className="space-y-2">
              <label
                htmlFor="playground-mode"
                className="text-sm font-semibold text-[hsl(var(--foreground))]"
              >
                Mode
              </label>
              <select
                id="playground-mode"
                name="mode"
                defaultValue={defaultMode}
                className="w-full rounded-2xl border border-[hsl(var(--border))] bg-card px-4 py-3 text-sm text-[hsl(var(--foreground))]"
              >
                {MODE_VALUES.map((mode) => (
                  <option key={mode} value={mode}>
                    {mode.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
              <p className="text-sm leading-6">
                Provider and model selection stay on the real gateway routing
                path.
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <label
              htmlFor="playground-system-prompt"
              className="text-sm font-semibold text-[hsl(var(--foreground))]"
            >
              System prompt
            </label>
            <textarea
              id="playground-system-prompt"
              name="systemPrompt"
              rows={4}
              placeholder="Optional instructions that apply only to this one-shot request."
              className="w-full rounded-2xl border border-[hsl(var(--border))] bg-card px-4 py-3 text-sm leading-6 text-[hsl(var(--foreground))]"
            />
          </div>

          <div className="space-y-2">
            <label
              htmlFor="playground-user-prompt"
              className="text-sm font-semibold text-[hsl(var(--foreground))]"
            >
              User prompt
            </label>
            <textarea
              id="playground-user-prompt"
              name="userPrompt"
              rows={7}
              required
              placeholder="Write the single request you want to send through the real gateway path."
              className="w-full rounded-2xl border border-[hsl(var(--border))] bg-card px-4 py-3 text-sm leading-6 text-[hsl(var(--foreground))]"
            />
            <p className="text-sm leading-6">
              Playground sends exactly these messages once and does not keep a
              conversation state on the admin side.
            </p>
          </div>

          <div className="space-y-3 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card-muted))] p-4">
            <div className="space-y-2">
              <label
                htmlFor="playground-raw-project-api-key"
                className="text-sm font-semibold text-[hsl(var(--foreground))]"
              >
                Raw project API key
              </label>
              <input
                id="playground-raw-project-api-key"
                name="rawProjectApiKey"
                type="password"
                value={rawProjectApiKey}
                onChange={(event) => setRawProjectApiKey(event.target.value)}
                autoComplete="off"
                placeholder="Paste the raw key shown once in the matching project detail."
                className="w-full rounded-2xl border border-[hsl(var(--border))] bg-card px-4 py-3 text-sm text-[hsl(var(--foreground))]"
              />
              <p className="text-sm leading-6">
                The admin server never stores this key. It forwards it only for
                real gateway validation and the one-shot request.
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="flex items-center gap-3 text-sm text-[hsl(var(--foreground))]">
                <input
                  type="checkbox"
                  checked={keepKeyInTab}
                  onChange={handleKeepKeyInTabChange}
                  className="h-4 w-4 rounded border-[hsl(var(--border))]"
                />
                <span>Keep this key only in this tab</span>
              </label>

              <button
                type="button"
                onClick={clearCurrentProjectKey}
                className="inline-flex items-center rounded-full border border-[hsl(var(--border))] bg-card px-4 py-2 text-sm font-semibold text-[hsl(var(--foreground))] transition-colors hover:border-[hsl(var(--foreground))]"
              >
                Clear current key
              </button>
            </div>

            <p className="text-sm leading-6">
              Turning this off clears every retained Playground key from the
              current browser tab.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <PlaygroundSubmitButton
              disabled={!selectedProject}
              pending={isPending}
            />
            <Link
              href="/requests"
              className="inline-flex items-center rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--card-muted))] px-4 py-2 text-sm font-semibold text-[hsl(var(--foreground))] transition-colors hover:border-[hsl(var(--foreground))]"
            >
              Open Requests
            </Link>
          </div>
        </form>
      </article>

      {lastSubmittedDraft ? (
        <PlaygroundAttemptPanel
          draft={lastSubmittedDraft}
          state={state}
          gatewayUrl={gatewayUrl}
          pending={isPending}
          copiedCurl={copiedCurl}
          onCopyCurl={handleCopyCurl}
        />
      ) : null}
    </div>
  );
}
