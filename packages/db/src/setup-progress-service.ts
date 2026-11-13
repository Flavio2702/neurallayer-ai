import { and, eq, inArray } from "drizzle-orm";

import { listProviderStatusSummaries } from "./admin-service";
import type { Database } from "./client";
import { withDatabase } from "./connection-helpers";
import { DEMO_PROJECT_ID } from "./demo";
import { gatewayApiKeys, projects, requests } from "./schema";

export type WorkspaceSetupProgressStepId =
  | "provider_configured"
  | "provider_tested"
  | "project_created"
  | "api_key_generated"
  | "first_request_sent";

export interface WorkspaceSetupProgressStep {
  id: WorkspaceSetupProgressStepId;
  title: string;
  description: string;
  completed: boolean;
}

export interface WorkspaceSetupProgress {
  totalStepCount: number;
  completedStepCount: number;
  nextStepId: WorkspaceSetupProgressStepId | null;
  steps: WorkspaceSetupProgressStep[];
}

const SETUP_PROGRESS_STEP_DEFINITIONS: Array<{
  id: WorkspaceSetupProgressStepId;
  title: string;
  description: string;
}> = [
  {
    id: "provider_configured",
    title: "Provider configured",
    description: "At least one real provider credential is stored.",
  },
  {
    id: "provider_tested",
    title: "Provider tested",
    description:
      "At least one explicit connection test passed for the current credential.",
  },
  {
    id: "project_created",
    title: "Project created",
    description: "At least one active non-demo project exists.",
  },
  {
    id: "api_key_generated",
    title: "API key generated",
    description:
      "At least one active project-scoped key exists on an active non-demo project.",
  },
  {
    id: "first_request_sent",
    title: "First request sent",
    description: "At least one non-demo request exists for a non-demo project.",
  },
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDemoProjectMetadata(metadata: unknown) {
  return isRecord(metadata) && metadata.isDemo === true;
}

function isNonDemoProject(project: {
  id: string;
  metadata: Record<string, unknown> | null;
}) {
  return (
    project.id !== DEMO_PROJECT_ID && !isDemoProjectMetadata(project.metadata)
  );
}

export async function getWorkspaceSetupProgress(
  workspaceId: string,
  database?: Database,
): Promise<WorkspaceSetupProgress> {
  return withDatabase(database, async (db) => {
    const [providerSummaries, projectRows] = await Promise.all([
      listProviderStatusSummaries(workspaceId, db),
      db
        .select({
          id: projects.id,
          status: projects.status,
          metadata: projects.metadata,
        })
        .from(projects)
        .where(eq(projects.workspaceId, workspaceId)),
    ]);

    const nonDemoProjects = projectRows.filter(isNonDemoProject);
    const activeNonDemoProjectIds = nonDemoProjects
      .filter((project) => project.status === "active")
      .map((project) => project.id);
    const nonDemoProjectIds = nonDemoProjects.map((project) => project.id);

    const [generatedApiKeyRows, firstRequestRows] = await Promise.all([
      activeNonDemoProjectIds.length === 0
        ? Promise.resolve([])
        : db
            .select({ id: gatewayApiKeys.id })
            .from(gatewayApiKeys)
            .where(
              and(
                eq(gatewayApiKeys.workspaceId, workspaceId),
                eq(gatewayApiKeys.status, "active"),
                inArray(gatewayApiKeys.projectId, activeNonDemoProjectIds),
              ),
            )
            .limit(1),
      nonDemoProjectIds.length === 0
        ? Promise.resolve([])
        : db
            .select({ id: requests.id })
            .from(requests)
            .where(
              and(
                eq(requests.workspaceId, workspaceId),
                inArray(requests.projectId, nonDemoProjectIds),
              ),
            )
            .limit(1),
    ]);

    const providerConfigured = providerSummaries.some(
      (summary) => summary.credentialState === "stored",
    );
    const providerTested = providerSummaries.some(
      (summary) =>
        summary.credentialState === "stored" &&
        summary.lastConnectionTest?.requestStatus === "succeeded",
    );
    const projectCreated = activeNonDemoProjectIds.length > 0;
    const apiKeyGenerated = generatedApiKeyRows.length > 0;
    const firstRequestSent = firstRequestRows.length > 0;

    const completionLookup = new Map<WorkspaceSetupProgressStepId, boolean>([
      ["provider_configured", providerConfigured],
      ["provider_tested", providerTested],
      ["project_created", projectCreated],
      ["api_key_generated", apiKeyGenerated],
      ["first_request_sent", firstRequestSent],
    ]);
    const steps = SETUP_PROGRESS_STEP_DEFINITIONS.map((definition) => ({
      ...definition,
      completed: completionLookup.get(definition.id) === true,
    }));
    const completedStepCount = steps.filter((step) => step.completed).length;
    const nextStepId = steps.find((step) => !step.completed)?.id ?? null;

    return {
      totalStepCount: steps.length,
      completedStepCount,
      nextStepId,
      steps,
    };
  });
}
