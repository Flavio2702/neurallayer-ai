import {
  getRequestsPageData,
  getTrialSummary,
  getWorkspaceOverviewStats,
  getWorkspaceSetupProgress,
  listProviderStatusSummaries,
  listRecentWorkspaceAuditEvents,
  listRecentWorkspaceRequests,
  resolveDefaultAdminWorkspace,
} from "@neuralayer/db";

import { normalizeTrialSummaryRange } from "@/lib/trial-summary-range";

function getUtcMonthRange(now = new Date()) {
  return {
    start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
    end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
  };
}

function getSnapshotErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

async function resolveAdminWorkspaceContext() {
  const workspaceContext = await resolveDefaultAdminWorkspace();

  if (!workspaceContext) {
    throw new Error(
      "No active workspace is available in the configured database.",
    );
  }

  return workspaceContext;
}

type WorkspaceContext = NonNullable<
  Awaited<ReturnType<typeof resolveDefaultAdminWorkspace>>
>;
type OverviewStats = Awaited<ReturnType<typeof getWorkspaceOverviewStats>>;
type SetupProgress = Awaited<ReturnType<typeof getWorkspaceSetupProgress>>;
type ProviderSummaries = Awaited<
  ReturnType<typeof listProviderStatusSummaries>
>;
type RequestsPageData = Awaited<ReturnType<typeof getRequestsPageData>>;
type TrialSummaryData = Awaited<ReturnType<typeof getTrialSummary>>;
type RecentRequests = Awaited<ReturnType<typeof listRecentWorkspaceRequests>>;
type RecentAuditEvents = Awaited<
  ReturnType<typeof listRecentWorkspaceAuditEvents>
>;

export type AdminOverviewSnapshot =
  | {
      available: false;
      errorMessage: string;
    }
  | {
      available: true;
      setupProgress: SetupProgress;
      stats: OverviewStats;
      providers: ProviderSummaries;
      blockedRecent: RequestsPageData["blockedRecent"];
      recentAuditEvents: RecentAuditEvents;
    };

export type AdminProvidersSnapshot =
  | {
      available: false;
      errorMessage: string;
    }
  | {
      available: true;
      workspaceContext: WorkspaceContext;
      providers: ProviderSummaries;
    };

export type AdminAuditSnapshot =
  | {
      available: false;
      errorMessage: string;
    }
  | {
      available: true;
      recentRequests: RecentRequests;
      recentAuditEvents: RecentAuditEvents;
    };

export type AdminTrialSummarySnapshot =
  | {
      available: false;
      errorMessage: string;
    }
  | {
      available: true;
      summary: TrialSummaryData;
    };

export async function loadAdminOverviewSnapshot(): Promise<AdminOverviewSnapshot> {
  try {
    const workspaceContext = await resolveAdminWorkspaceContext();
    const monthRange = getUtcMonthRange();
    const [
      setupProgress,
      stats,
      providers,
      requestsPageData,
      recentAuditEvents,
    ] = await Promise.all([
      getWorkspaceSetupProgress(workspaceContext.workspace.id),
      getWorkspaceOverviewStats({
        workspaceId: workspaceContext.workspace.id,
        start: monthRange.start,
        end: monthRange.end,
      }),
      listProviderStatusSummaries(workspaceContext.workspace.id),
      getRequestsPageData({
        workspaceId: workspaceContext.workspace.id,
        limit: 1,
        blockedLimit: 6,
        auditLimit: 1,
      }),
      listRecentWorkspaceAuditEvents({
        workspaceId: workspaceContext.workspace.id,
        limit: 8,
      }),
    ]);

    return {
      available: true,
      setupProgress,
      stats,
      providers,
      blockedRecent: requestsPageData.blockedRecent,
      recentAuditEvents,
    };
  } catch (error) {
    return {
      available: false,
      errorMessage: getSnapshotErrorMessage(
        error,
        "The admin overview could not load database-backed state.",
      ),
    };
  }
}

export async function loadAdminProvidersSnapshot(): Promise<AdminProvidersSnapshot> {
  try {
    const workspaceContext = await resolveAdminWorkspaceContext();
    const providers = await listProviderStatusSummaries(
      workspaceContext.workspace.id,
    );

    return {
      available: true,
      workspaceContext,
      providers,
    };
  } catch (error) {
    return {
      available: false,
      errorMessage: getSnapshotErrorMessage(
        error,
        "Provider setup could not load database-backed state.",
      ),
    };
  }
}

export async function loadAdminAuditSnapshot(): Promise<AdminAuditSnapshot> {
  try {
    const workspaceContext = await resolveAdminWorkspaceContext();
    const [recentRequests, recentAuditEvents] = await Promise.all([
      listRecentWorkspaceRequests({
        workspaceId: workspaceContext.workspace.id,
        limit: 8,
      }),
      listRecentWorkspaceAuditEvents({
        workspaceId: workspaceContext.workspace.id,
        limit: 12,
      }),
    ]);

    return {
      available: true,
      recentRequests,
      recentAuditEvents,
    };
  } catch (error) {
    return {
      available: false,
      errorMessage: getSnapshotErrorMessage(
        error,
        "The audit page could not load database-backed state.",
      ),
    };
  }
}

export async function loadAdminTrialSummarySnapshot(input?: {
  rangeParam?: string;
}): Promise<AdminTrialSummarySnapshot> {
  try {
    const workspaceContext = await resolveAdminWorkspaceContext();
    const range = normalizeTrialSummaryRange(input?.rangeParam);
    const summary = await getTrialSummary({
      workspaceId: workspaceContext.workspace.id,
      range,
    });

    return {
      available: true,
      summary,
    };
  } catch (error) {
    return {
      available: false,
      errorMessage: getSnapshotErrorMessage(
        error,
        "The trial summary page could not load database-backed state.",
      ),
    };
  }
}
