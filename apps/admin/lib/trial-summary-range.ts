import {
  TRIAL_SUMMARY_RANGE_VALUES,
  type TrialSummaryRange,
} from "@neuralayer/db";

export const DEFAULT_TRIAL_SUMMARY_RANGE: TrialSummaryRange = "30d";

const trialSummaryRangeSet = new Set<TrialSummaryRange>(
  TRIAL_SUMMARY_RANGE_VALUES,
);

export function normalizeTrialSummaryRange(
  value: string | null | undefined,
): TrialSummaryRange {
  if (value && trialSummaryRangeSet.has(value as TrialSummaryRange)) {
    return value as TrialSummaryRange;
  }

  return DEFAULT_TRIAL_SUMMARY_RANGE;
}
