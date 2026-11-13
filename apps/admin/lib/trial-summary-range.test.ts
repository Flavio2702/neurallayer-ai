import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_TRIAL_SUMMARY_RANGE,
  normalizeTrialSummaryRange,
} from "./trial-summary-range";

test("normalizeTrialSummaryRange keeps supported values and falls back to 30d otherwise", () => {
  assert.equal(DEFAULT_TRIAL_SUMMARY_RANGE, "30d");
  assert.equal(normalizeTrialSummaryRange("7d"), "7d");
  assert.equal(normalizeTrialSummaryRange("30d"), "30d");
  assert.equal(normalizeTrialSummaryRange(null), "30d");
  assert.equal(normalizeTrialSummaryRange(undefined), "30d");
  assert.equal(normalizeTrialSummaryRange("14d"), "30d");
  assert.equal(normalizeTrialSummaryRange(" 7d "), "30d");
});
