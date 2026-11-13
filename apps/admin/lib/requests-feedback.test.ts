import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRequestsFeedbackRedirectUrl,
  getKnownRequestsFeedbackErrorMessage,
  getRequestAnchorId,
  isRequestsStatusFilterValue,
} from "./requests-feedback";

test("buildRequestsFeedbackRedirectUrl preserves filters, request anchor, and success notice", () => {
  assert.equal(getRequestAnchorId("req_trial"), "request-req_trial");
  assert.equal(
    buildRequestsFeedbackRedirectUrl({
      projectId: "proj_trial",
      status: "blocked",
      feedbackRequestId: "req_trial",
      notice: "feedback_saved",
    }),
    "/requests?project=proj_trial&status=blocked&feedbackRequest=req_trial&feedbackNotice=feedback_saved#request-req_trial",
  );
  assert.equal(
    buildRequestsFeedbackRedirectUrl({
      feedbackRequestId: "req_trial",
    }),
    "/requests?feedbackRequest=req_trial#request-req_trial",
  );
  assert.equal(buildRequestsFeedbackRedirectUrl({}), "/requests");
});

test("requests feedback helpers keep status validation and stable known error messages", () => {
  assert.equal(isRequestsStatusFilterValue("running"), true);
  assert.equal(isRequestsStatusFilterValue("succeeded"), true);
  assert.equal(isRequestsStatusFilterValue("failed"), true);
  assert.equal(isRequestsStatusFilterValue("blocked"), true);
  assert.equal(isRequestsStatusFilterValue("queued"), false);

  assert.equal(
    getKnownRequestsFeedbackErrorMessage("request_not_found"),
    "This request is no longer available in the current workspace.",
  );
  assert.equal(
    getKnownRequestsFeedbackErrorMessage("invalid_feedback_value"),
    "Choose useful, needs follow-up, or not useful before saving feedback.",
  );
  assert.equal(
    getKnownRequestsFeedbackErrorMessage("note_too_long"),
    "Keep the optional note short before saving feedback.",
  );
});
