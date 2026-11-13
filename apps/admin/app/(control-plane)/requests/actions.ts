"use server";

import {
  MANUAL_REQUEST_FEEDBACK_VALUES,
  ManualRequestFeedbackError,
  type ManualRequestFeedbackValue,
  upsertManualRequestFeedback,
} from "@neuralayer/db";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireAdminSession } from "@/lib/admin-access-gate";
import {
  buildRequestsFeedbackRedirectUrl,
  getKnownRequestsFeedbackErrorMessage,
  isRequestsStatusFilterValue,
} from "@/lib/requests-feedback";

function isManualRequestFeedbackValue(
  value: string,
): value is ManualRequestFeedbackValue {
  return MANUAL_REQUEST_FEEDBACK_VALUES.includes(
    value as ManualRequestFeedbackValue,
  );
}

function redirectToRequests(
  input: Parameters<typeof buildRequestsFeedbackRedirectUrl>[0],
): never {
  redirect(buildRequestsFeedbackRedirectUrl(input));
}

export async function recordManualRequestFeedback(formData: FormData) {
  await requireAdminSession();

  const workspaceId = String(formData.get("workspaceId") ?? "").trim();
  const requestId = String(formData.get("requestId") ?? "").trim();
  const rawValue = String(formData.get("value") ?? "").trim();
  const note = String(formData.get("note") ?? "");
  const returnProjectId = String(formData.get("returnProjectId") ?? "").trim();
  const rawReturnStatus = String(formData.get("returnStatus") ?? "").trim();
  const returnStatus = isRequestsStatusFilterValue(rawReturnStatus)
    ? rawReturnStatus
    : undefined;

  if (!workspaceId || !requestId) {
    redirectToRequests({
      projectId: returnProjectId || undefined,
      status: returnStatus,
      feedbackRequestId: requestId || undefined,
      error: "Invalid request context. Refresh Requests and try again.",
    });
  }

  if (!isManualRequestFeedbackValue(rawValue)) {
    redirectToRequests({
      projectId: returnProjectId || undefined,
      status: returnStatus,
      feedbackRequestId: requestId,
      error:
        "Choose useful, needs follow-up, or not useful before saving feedback.",
    });
  }

  try {
    await upsertManualRequestFeedback({
      workspaceId,
      requestId,
      value: rawValue,
      note,
    });
  } catch (error) {
    if (error instanceof ManualRequestFeedbackError) {
      redirectToRequests({
        projectId: returnProjectId || undefined,
        status: returnStatus,
        feedbackRequestId: requestId,
        error: getKnownRequestsFeedbackErrorMessage(error.code),
      });
    }

    redirectToRequests({
      projectId: returnProjectId || undefined,
      status: returnStatus,
      feedbackRequestId: requestId,
      error:
        "Outcome feedback save failed unexpectedly. Refresh Requests and try again.",
    });
  }

  revalidatePath("/requests");
  revalidatePath("/audit");
  redirectToRequests({
    projectId: returnProjectId || undefined,
    status: returnStatus,
    feedbackRequestId: requestId,
    notice: "feedback_saved",
  });
}
