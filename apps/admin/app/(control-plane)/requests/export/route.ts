import {
  getRequestsCsvExport,
  resolveDefaultAdminWorkspace,
} from "@neuralayer/db";

import { requireAdminSession } from "@/lib/admin-access-gate";
import {
  buildRequestsCsvFilename,
  serializeRequestsCsv,
} from "@/lib/requests-csv";
import { normalizeTrialSummaryRange } from "@/lib/trial-summary-range";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  await requireAdminSession();

  try {
    const workspaceContext = await resolveDefaultAdminWorkspace();

    if (!workspaceContext) {
      return new Response(
        "No active workspace is available in the configured database.",
        {
          status: 503,
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "no-store",
          },
        },
      );
    }

    const url = new URL(request.url);
    const range = normalizeTrialSummaryRange(url.searchParams.get("range"));
    const exportData = await getRequestsCsvExport({
      workspaceId: workspaceContext.workspace.id,
      range,
    });
    const filename = buildRequestsCsvFilename({
      workspaceSlug: workspaceContext.workspace.slug,
      range,
    });

    return new Response(serializeRequestsCsv(exportData.rows), {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return new Response(
      error instanceof Error
        ? error.message
        : "Requests CSV export could not load database-backed state.",
      {
        status: 500,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-store",
        },
      },
    );
  }
}
