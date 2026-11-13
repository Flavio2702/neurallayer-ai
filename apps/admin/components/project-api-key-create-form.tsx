"use client";

import type { ProjectSummary } from "@neuralayer/db";
import { type FormEvent, useEffect, useState, useTransition } from "react";

import { createProjectGatewayApiKeyFromAdmin } from "@/app/(control-plane)/projects/actions";
import {
  buildGatewayChatCompletionsCurlSnippet,
  PROJECT_GATEWAY_API_KEY_PLACEHOLDER,
} from "@/lib/gateway-curl-snippet";
import { initialProjectApiKeyCreateFormState } from "@/lib/project-api-key-create-form-state";

interface ProjectApiKeyCreateFormProps {
  workspaceId: string;
  projectId: string;
  projectSlug: string;
  projectStatus: ProjectSummary["status"];
  gatewayUrl: string;
}

function CreateProjectApiKeySubmitButton(input: {
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
      {input.pending ? "Generating key..." : "Generate project key"}
    </button>
  );
}

export function ProjectApiKeyCreateForm({
  workspaceId,
  projectId,
  projectSlug,
  projectStatus,
  gatewayUrl,
}: ProjectApiKeyCreateFormProps) {
  const [state, setState] = useState(initialProjectApiKeyCreateFormState);
  const [copiedTarget, setCopiedTarget] = useState<"raw" | "curl" | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [isPending, startTransition] = useTransition();
  const revealedRawKey = state.rawKey;

  useEffect(() => {
    setHydrated(true);
  }, []);

  const createDisabled = projectStatus !== "active" || !hydrated || isPending;
  const curlSnippet =
    state.curlSnippet ??
    buildGatewayChatCompletionsCurlSnippet({
      apiKey: PROJECT_GATEWAY_API_KEY_PLACEHOLDER,
      gatewayUrl,
      projectId,
    });

  async function copyValue(value: string, target: "raw" | "curl") {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedTarget(target);
    } catch {
      setCopiedTarget(null);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const form = event.currentTarget;
    const formData = new FormData(form);

    startTransition(async () => {
      const nextState = await createProjectGatewayApiKeyFromAdmin(formData);

      setCopiedTarget(null);
      setState(nextState);

      if (nextState.status === "success") {
        form.reset();
      }
    });
  }

  return (
    <article className="rounded-2xl border border-[hsl(var(--border))] bg-card p-4 text-sm text-[hsl(var(--muted))]">
      <div data-project-api-key-create-ready={hydrated ? "true" : "false"} />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-[hsl(var(--foreground))]">
            Create project API key
          </p>
          <p className="mt-3">
            Generate a project-scoped key with a readable name, reveal it once,
            and keep the raw value out of every stored admin read model.
          </p>
        </div>
      </div>

      {createDisabled ? (
        <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm leading-6 text-amber-800">
          Activate this project before generating a new key. Existing key
          summaries remain visible below.
        </div>
      ) : null}

      {state.status === "error" && state.message ? (
        <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-4 text-sm leading-6 text-rose-700">
          {state.message}
        </div>
      ) : null}

      {state.status === "success" && state.message ? (
        <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm leading-6 text-emerald-700">
          {state.message}
        </div>
      ) : null}

      <form onSubmit={handleSubmit} className="mt-4 space-y-3">
        <input type="hidden" name="workspaceId" value={workspaceId} />
        <input type="hidden" name="projectId" value={projectId} />
        <input type="hidden" name="projectSlug" value={projectSlug} />

        <div className="space-y-2">
          <label
            htmlFor="project-api-key-name"
            className="text-sm font-semibold text-[hsl(var(--foreground))]"
          >
            Key name
          </label>
          <input
            id="project-api-key-name"
            name="name"
            type="text"
            placeholder="Partner production key"
            disabled={createDisabled}
            className="w-full rounded-2xl border border-[hsl(var(--border))] bg-card px-4 py-3 text-sm text-[hsl(var(--foreground))] disabled:cursor-not-allowed disabled:bg-[hsl(var(--card-muted))]"
          />
          <p className="text-sm leading-6 text-[hsl(var(--muted))]">
            Use a label your team will recognize in audit and request context.
          </p>
        </div>

        <CreateProjectApiKeySubmitButton
          disabled={createDisabled}
          pending={isPending}
        />
      </form>

      {revealedRawKey ? (
        <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">
                Raw key shown once
              </p>
              <p className="mt-2 text-sm leading-6 text-emerald-700">
                Copy this now. Reloading or reopening the page drops the raw
                value and only the stored key prefix remains visible.
              </p>
              {state.apiKey ? (
                <div className="mt-2 space-y-1 text-xs text-emerald-700">
                  <p>Key name: {state.apiKey.name}</p>
                  <p className="font-mono">
                    Stored prefix: {state.apiKey.keyPrefix}
                  </p>
                </div>
              ) : null}
            </div>

            <button
              type="button"
              onClick={() => copyValue(revealedRawKey, "raw")}
              className="inline-flex items-center rounded-full border border-emerald-300 bg-white px-4 py-2 text-sm font-semibold text-emerald-700"
            >
              {copiedTarget === "raw" ? "Raw key copied" : "Copy raw key"}
            </button>
          </div>

          <pre className="mt-4 overflow-x-auto rounded-2xl bg-white px-4 py-4 font-mono text-sm leading-6 text-[hsl(var(--foreground))]">
            {revealedRawKey}
          </pre>
        </div>
      ) : null}

      <div className="mt-4 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--foreground))] px-4 py-4 text-sm text-slate-100">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-300">
              Copyable curl
            </p>
            <p className="mt-2 text-sm leading-6 text-slate-300">
              The snippet keeps `project_id` explicit. When no raw key is in the
              current one-time reveal, it falls back to a paste placeholder.
            </p>
          </div>

          <button
            type="button"
            onClick={() => copyValue(curlSnippet, "curl")}
            className="inline-flex items-center rounded-full border border-slate-600 bg-slate-800 px-4 py-2 text-sm font-semibold text-slate-100"
          >
            {copiedTarget === "curl" ? "Curl copied" : "Copy curl"}
          </button>
        </div>

        <pre className="mt-4 overflow-x-auto whitespace-pre-wrap leading-6">
          {curlSnippet}
        </pre>
      </div>
    </article>
  );
}
