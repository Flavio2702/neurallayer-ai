import type { ManualRequestFeedbackErrorCode } from "@neuralayer/db";

export const REQUESTS_STATUS_FILTER_VALUES = [
  "running",
  "succeeded",
  "failed",
  "blocked",
] as const;

export type RequestsStatusFilterValue =
  (typeof REQUESTS_STATUS_FILTER_VALUES)[number];
export type RequestsFeedbackNotice = "feedback_saved";

export function isRequestsStatusFilterValue(
  value: string,
): value is RequestsStatusFilterValue {
  return REQUESTS_STATUS_FILTER_VALUES.includes(
    value as RequestsStatusFilterValue,
  );
}

export function getRequestAnchorId(requestId: string) {
  return `request-${requestId}`;
}

export function buildRequestsFeedbackRedirectUrl(input: {
  projectId?: string;
  status?: RequestsStatusFilterValue;
  feedbackRequestId?: string;
  notice?: RequestsFeedbackNotice;
  error?: string;
}) {
  const searchParams = new URLSearchParams();

  if (input.projectId) {
    searchParams.set("project", input.projectId);
  }

  if (input.status) {
    searchParams.set("status", input.status);
  }

  if (input.feedbackRequestId) {
    searchParams.set("feedbackRequest", input.feedbackRequestId);
  }

  if (input.notice) {
    searchParams.set("feedbackNotice", input.notice);
  }

  if (input.error) {
    searchParams.set("feedbackError", input.error);
  }

  const query = searchParams.toString();
  const anchor = input.feedbackRequestId
    ? `#${getRequestAnchorId(input.feedbackRequestId)}`
    : "";

  return query.length > 0
    ? `/requests?${query}${anchor}`
    : `/requests${anchor}`;
}

export function getKnownRequestsFeedbackErrorMessage(
  code: ManualRequestFeedbackErrorCode,
) {
  switch (code) {
    case "request_not_found":
      return "This request is no longer available in the current workspace.";
    case "invalid_feedback_value":
      return "Choose useful, needs follow-up, or not useful before saving feedback.";
    case "note_too_long":
      return "Keep the optional note short before saving feedback.";
    default:
      return "The outcome feedback could not be saved.";
  }
}
