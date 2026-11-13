import { ControlPlanePanel } from "@/components/control-plane-panel";
import { StatusBadge } from "@/components/status-badge";
import {
  type AdminProvidersSnapshot,
  loadAdminProvidersSnapshot,
} from "@/lib/control-plane-data";
import { formatDateTime } from "@/lib/format";

import { saveProviderCredentials, testProviderConnection } from "./actions";

interface ProvidersPageProps {
  searchParams?: Promise<{
    error?: string;
    notice?: string;
    provider?: string;
  }>;
}

type ProviderSummary = Extract<
  AdminProvidersSnapshot,
  { available: true }
>["providers"][number];

function getProviderLabel(provider: string | undefined) {
  switch (provider) {
    case "openai":
      return "OpenAI";
    case "anthropic":
      return "Anthropic";
    default:
      return "Provider";
  }
}

function getNoticeState(input: {
  notice?: string;
  provider?: string;
  error?: string;
}) {
  const providerLabel = getProviderLabel(input.provider);

  switch (input.notice) {
    case "credential_saved":
      return {
        tone: "success",
        message: `Saved the ${providerLabel} credential. Run Test connection before routing real traffic.`,
      } as const;
    case "connection_test_succeeded":
      return {
        tone: "success",
        message: `Connection test passed for ${providerLabel}. This provider is ready for routing.`,
      } as const;
    case "connection_test_failed":
      return {
        tone: "danger",
        message: input.error
          ? `Connection test failed for ${providerLabel}. ${input.error}`
          : `Connection test failed for ${providerLabel}. Review the provider status and try again.`,
      } as const;
    default:
      return input.error
        ? ({
            tone: "danger",
            message: input.error,
          } as const)
        : null;
  }
}

function getNoticeClasses(tone: "success" | "danger") {
  return tone === "success"
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : "border-rose-200 bg-rose-50 text-rose-700";
}

function getReadinessTone(readiness: ProviderSummary["readiness"]) {
  switch (readiness) {
    case "ready":
      return "success";
    case "configured":
      return "info";
    case "attention":
      return "danger";
    default:
      return "warning";
  }
}

function getReadinessCopy(provider: ProviderSummary) {
  switch (provider.readiness) {
    case "ready":
      return "Saved credentials and the latest DB-backed provider posture say this provider is ready for routing.";
    case "configured":
      return "The credential is saved, but the latest explicit connection test is missing or older than the current key.";
    case "attention":
      return "A credential exists, but the latest DB-backed provider posture needs attention before routing traffic here.";
    default:
      return "Save a workspace credential first. Until then, this provider is not ready for routing.";
  }
}

function getOperationalTone(
  status: "active" | "inactive" | "error" | null | undefined,
) {
  switch (status) {
    case "active":
      return "success";
    case "error":
      return "danger";
    case "inactive":
      return "warning";
    default:
      return "neutral";
  }
}

function getOperationalLabel(provider: ProviderSummary) {
  if (!provider.account) {
    return "missing";
  }

  return provider.account.status;
}

function getOperationalCopy(provider: ProviderSummary) {
  if (!provider.account) {
    return "No provider account record exists yet for this workspace.";
  }

  if (provider.account.status === "error") {
    return "The latest provider posture hit a configuration or auth problem that needs attention.";
  }

  if (provider.account.status === "inactive") {
    return "The provider account is inactive and should not be used for routing.";
  }

  if (provider.lastOutcome?.requestStatus === "succeeded") {
    return "The latest DB-backed provider signal succeeded.";
  }

  if (provider.readiness === "configured") {
    return "The account is active, but the current credential still needs a fresh connection test.";
  }

  if (provider.lastOutcome) {
    return "The account is active, but the latest provider signal needs review before routing.";
  }

  return "The account record exists and is active, but no provider signal has been recorded yet.";
}

function getCredentialSummary(provider: ProviderSummary) {
  if (provider.credentialState !== "stored") {
    return "No saved credential is available yet.";
  }

  return provider.credentialPreview
    ? `Saved key ${provider.credentialPreview}`
    : "A credential is saved for this provider.";
}

function getConnectionTestTone(provider: ProviderSummary) {
  if (!provider.lastConnectionTest) {
    return "info";
  }

  return provider.lastConnectionTest.requestStatus === "succeeded"
    ? "success"
    : "danger";
}

function getConnectionTestLabel(provider: ProviderSummary) {
  if (!provider.lastConnectionTest) {
    return "not tested";
  }

  return provider.lastConnectionTest.requestStatus === "succeeded"
    ? "passed"
    : "failed";
}

function getConnectionTestCopy(provider: ProviderSummary) {
  if (!provider.lastConnectionTest) {
    return "No explicit connection test has run since the latest credential save.";
  }

  return provider.lastConnectionTest.modelId
    ? `Latest explicit test used ${provider.lastConnectionTest.modelId}.`
    : "Latest explicit test completed without a recorded model id.";
}

function getLatestSignalCopy(provider: ProviderSummary) {
  if (!provider.lastOutcome) {
    return "No provider test or runtime signal has been recorded yet.";
  }

  const sourceLabel =
    provider.lastOutcome.source === "provider_test"
      ? "Connection test"
      : "Runtime";

  return `${sourceLabel} ${provider.lastOutcome.requestStatus} on ${formatDateTime(provider.lastOutcome.testedAt)}.`;
}

function getLastErrorCopy(provider: ProviderSummary) {
  return (
    provider.lastOutcome?.errorMessage ??
    provider.lastOutcome?.errorCode ??
    provider.lastConnectionTest?.errorMessage ??
    provider.lastConnectionTest?.errorCode ??
    "No error recorded."
  );
}

function getProviderEnvLabel(provider: ProviderSummary["provider"]) {
  return provider === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY";
}

export default async function ProvidersPage({
  searchParams,
}: ProvidersPageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const noticeState = getNoticeState({
    notice: resolvedSearchParams?.notice,
    provider: resolvedSearchParams?.provider,
    error: resolvedSearchParams?.error,
  });
  const snapshot = await loadAdminProvidersSnapshot();

  if (!snapshot.available) {
    return (
      <ControlPlanePanel
        title="Database state unavailable"
        description="Provider setup stays server-rendered and DB-backed; there is no fake local-only form path."
      >
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-5 text-sm leading-6 text-rose-700">
          {snapshot.errorMessage}
        </div>
      </ControlPlanePanel>
    );
  }

  return (
    <div className="grid gap-6">
      {noticeState ? (
        <div
          className={`rounded-2xl border px-4 py-4 text-sm ${getNoticeClasses(noticeState.tone)}`}
        >
          {noticeState.message}
        </div>
      ) : null}

      <ControlPlanePanel
        title="Self-serve provider setup"
        description="Save a workspace credential first, then run a dedicated connection test. The page stays DB-backed and never shows the raw secret again after save."
      >
        <div className="grid gap-3 md:grid-cols-3">
          <article className="rounded-2xl border border-[hsl(var(--border))] bg-card p-4 text-sm text-[hsl(var(--muted))]">
            <p className="font-semibold text-[hsl(var(--foreground))]">
              1. Save credential
            </p>
            <p className="mt-2">
              Store a workspace API key for OpenAI or Anthropic. Saving a new
              key replaces the old one and clears the previous test result.
            </p>
          </article>

          <article className="rounded-2xl border border-[hsl(var(--border))] bg-card p-4 text-sm text-[hsl(var(--muted))]">
            <p className="font-semibold text-[hsl(var(--foreground))]">
              2. Test connection
            </p>
            <p className="mt-2">
              Run the provider-specific connection test from this page. It
              updates provider posture without creating a demo request history
              entry.
            </p>
          </article>

          <article className="rounded-2xl border border-[hsl(var(--border))] bg-card p-4 text-sm text-[hsl(var(--muted))]">
            <p className="font-semibold text-[hsl(var(--foreground))]">
              3. Route with confidence
            </p>
            <p className="mt-2">
              Use the routing readiness status to see whether the current saved
              credential is actually ready for live traffic.
            </p>
          </article>
        </div>
      </ControlPlanePanel>

      <div className="grid gap-6 xl:grid-cols-2">
        {snapshot.providers.map((provider) => (
          <ControlPlanePanel
            key={provider.provider}
            className="min-w-0"
            title={provider.displayName}
            description={`Workspace-level BYOK setup for ${getProviderLabel(provider.provider)}. Save a credential, run a dedicated connection test, and confirm routing readiness from live DB state.`}
          >
            <div className="space-y-4">
              <div className="flex flex-col gap-4 rounded-2xl border border-[hsl(var(--border))] bg-card p-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-[hsl(var(--foreground))]">
                    {provider.modelCoverageCount} chat-capable catalog models
                    available
                  </p>
                  <p className="mt-1 break-words text-sm leading-6 text-[hsl(var(--muted))]">
                    Latest operational signal: {getLatestSignalCopy(provider)}
                  </p>
                </div>

                <div className="flex max-w-full flex-wrap gap-2 sm:justify-end">
                  <StatusBadge tone={getReadinessTone(provider.readiness)}>
                    {provider.readiness.replace("_", " ")}
                  </StatusBadge>
                  <StatusBadge
                    tone={getOperationalTone(provider.account?.status)}
                  >
                    {getOperationalLabel(provider)}
                  </StatusBadge>
                </div>
              </div>

              <div className="grid gap-4">
                <article className="min-w-0 rounded-2xl border border-[hsl(var(--border))] bg-card p-4 text-sm leading-6 text-[hsl(var(--muted))]">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <p className="min-w-0 font-semibold text-[hsl(var(--foreground))]">
                      Routing readiness
                    </p>
                    <StatusBadge tone={getReadinessTone(provider.readiness)}>
                      {provider.readiness.replace("_", " ")}
                    </StatusBadge>
                  </div>

                  <p className="mt-4 break-words">
                    {getReadinessCopy(provider)}
                  </p>
                  <p className="mt-4 break-words">
                    Credential updated:{" "}
                    {formatDateTime(provider.account?.credentialUpdatedAt)}
                  </p>
                </article>

                <article className="min-w-0 rounded-2xl border border-[hsl(var(--border))] bg-card p-4 text-sm leading-6 text-[hsl(var(--muted))]">
                  <p className="font-semibold text-[hsl(var(--foreground))]">
                    Credential
                  </p>
                  <p className="mt-4 break-words">
                    {getCredentialSummary(provider)}
                  </p>
                  <p className="mt-3 break-words">
                    Raw secrets never appear again after save. Use a new save
                    whenever you want to replace the stored key.
                  </p>

                  <form
                    action={saveProviderCredentials}
                    className="mt-4 space-y-4 rounded-2xl border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--card-muted))] p-4"
                  >
                    <input
                      type="hidden"
                      name="workspaceId"
                      value={snapshot.workspaceContext.workspace.id}
                    />
                    <input
                      type="hidden"
                      name="provider"
                      value={provider.provider}
                    />

                    <div className="space-y-2">
                      <label
                        htmlFor={`api-key-${provider.provider}`}
                        className="block break-words text-sm font-semibold text-[hsl(var(--foreground))]"
                      >
                        {getProviderEnvLabel(provider.provider)}
                      </label>
                      <input
                        id={`api-key-${provider.provider}`}
                        name="apiKey"
                        type="password"
                        autoComplete="off"
                        spellCheck={false}
                        placeholder={`Paste the ${getProviderLabel(provider.provider)} API key`}
                        className="w-full min-w-0 rounded-2xl border border-[hsl(var(--border))] bg-card px-4 py-3 text-sm text-[hsl(var(--foreground))]"
                      />
                    </div>

                    <button
                      type="submit"
                      className="inline-flex w-full items-center justify-center rounded-full border border-[hsl(var(--primary))] bg-[hsl(var(--primary))] px-4 py-2 text-sm font-semibold text-white transition-colors hover:opacity-90 sm:w-auto"
                    >
                      Save credential
                    </button>
                  </form>
                </article>

                <article className="min-w-0 rounded-2xl border border-[hsl(var(--border))] bg-card p-4 text-sm leading-6 text-[hsl(var(--muted))]">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <p className="min-w-0 font-semibold text-[hsl(var(--foreground))]">
                      Connection test & status
                    </p>
                    <StatusBadge tone={getConnectionTestTone(provider)}>
                      {getConnectionTestLabel(provider)}
                    </StatusBadge>
                  </div>

                  <p className="mt-4 break-words">
                    Operational status: {getOperationalLabel(provider)}
                  </p>
                  <p className="mt-3 break-words">
                    {getOperationalCopy(provider)}
                  </p>
                  <p className="mt-4 break-words">
                    Last connection test:{" "}
                    {formatDateTime(provider.lastConnectionTest?.testedAt)}
                  </p>
                  <p className="mt-3 break-words">
                    {getConnectionTestCopy(provider)}
                  </p>
                  <p className="mt-4 break-words">
                    Last error: {getLastErrorCopy(provider)}
                  </p>

                  <form
                    action={testProviderConnection}
                    className="mt-4 space-y-4 rounded-2xl border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--card-muted))] p-4"
                  >
                    <input
                      type="hidden"
                      name="workspaceId"
                      value={snapshot.workspaceContext.workspace.id}
                    />
                    <input
                      type="hidden"
                      name="provider"
                      value={provider.provider}
                    />

                    <p className="text-sm text-[hsl(var(--muted))]">
                      Run a dedicated provider connection check with the
                      currently saved credential.
                    </p>
                    <button
                      type="submit"
                      disabled={provider.credentialState !== "stored"}
                      className="inline-flex w-full items-center justify-center rounded-full border border-[hsl(var(--border))] bg-card px-4 py-2 text-sm font-semibold text-[hsl(var(--foreground))] transition-colors hover:border-[hsl(var(--foreground))] disabled:cursor-not-allowed disabled:hover:border-[hsl(var(--border))] disabled:opacity-60 sm:w-auto"
                    >
                      Test connection
                    </button>
                    {provider.credentialState !== "stored" ? (
                      <p className="break-words text-sm text-[hsl(var(--muted))]">
                        Save a credential first to unlock the connection test.
                      </p>
                    ) : (
                      <p className="break-words text-sm text-[hsl(var(--muted))]">
                        Use this after every credential update before routing
                        live traffic.
                      </p>
                    )}
                  </form>
                </article>
              </div>
            </div>
          </ControlPlanePanel>
        ))}
      </div>
    </div>
  );
}
