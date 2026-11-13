"use server";

import { PROVIDER_NAME_VALUES, type ProviderName } from "@neuralayer/core";
import {
  testWorkspaceProviderConnection,
  upsertProviderCredentials,
} from "@neuralayer/db";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireAdminSession } from "@/lib/admin-access-gate";
import { createAdminProviderConnectionTestRunner } from "@/lib/provider-connection-test-runner";

const providerConnectionTestRunner = createAdminProviderConnectionTestRunner();

function isProviderName(value: string): value is ProviderName {
  return PROVIDER_NAME_VALUES.includes(value as ProviderName);
}

function revalidateProviderSurfaces() {
  revalidatePath("/");
  revalidatePath("/providers");
  revalidatePath("/audit");
}

function redirectToProviders(input: {
  provider?: string;
  notice?:
    | "credential_saved"
    | "connection_test_succeeded"
    | "connection_test_failed";
  error?: string;
}): never {
  const searchParams = new URLSearchParams();

  if (input.provider) {
    searchParams.set("provider", input.provider);
  }

  if (input.notice) {
    searchParams.set("notice", input.notice);
  }

  if (input.error) {
    searchParams.set("error", input.error);
  }

  const query = searchParams.toString();

  redirect(query.length > 0 ? `/providers?${query}` : "/providers");
}

export async function saveProviderCredentials(formData: FormData) {
  await requireAdminSession();

  const workspaceId = String(formData.get("workspaceId") ?? "").trim();
  const providerValue = String(formData.get("provider") ?? "").trim();
  const apiKey = String(formData.get("apiKey") ?? "").trim();

  if (!workspaceId || !isProviderName(providerValue)) {
    redirectToProviders({
      error: "Invalid provider context.",
    });
  }

  if (!apiKey) {
    redirectToProviders({
      provider: providerValue,
      error: "Enter an API key before saving this provider.",
    });
  }

  try {
    await upsertProviderCredentials({
      workspaceId,
      provider: providerValue,
      apiKey,
    });
  } catch {
    redirectToProviders({
      provider: providerValue,
      error: "Provider credential save failed. Try again with a valid API key.",
    });
  }

  revalidateProviderSurfaces();
  redirectToProviders({
    provider: providerValue,
    notice: "credential_saved",
  });
}

export async function testProviderConnection(formData: FormData) {
  await requireAdminSession();

  const workspaceId = String(formData.get("workspaceId") ?? "").trim();
  const providerValue = String(formData.get("provider") ?? "").trim();

  if (!workspaceId || !isProviderName(providerValue)) {
    redirectToProviders({
      error: "Invalid provider context.",
    });
  }

  let result: Awaited<ReturnType<typeof testWorkspaceProviderConnection>>;

  try {
    result = await testWorkspaceProviderConnection(
      {
        workspaceId,
        provider: providerValue,
      },
      {
        runConnectionTest: async (input) =>
          providerConnectionTestRunner.run(input),
      },
    );
  } catch {
    redirectToProviders({
      provider: providerValue,
      notice: "connection_test_failed",
      error:
        "Provider connection test failed unexpectedly. Check the provider status and try again.",
    });
  }

  revalidateProviderSurfaces();

  if (result.requestStatus === "succeeded") {
    redirectToProviders({
      provider: providerValue,
      notice: "connection_test_succeeded",
    });
  }

  redirectToProviders({
    provider: providerValue,
    notice: "connection_test_failed",
    error:
      result.error?.message ??
      "Provider connection test failed. Review the provider status and try again.",
  });
}
