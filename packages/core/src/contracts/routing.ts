import type {
  BenchmarkSourceName,
  CapabilityClass,
  CostTier,
  LatencyTier,
  ProviderName,
} from "../enums";
import type { JsonObject } from "./common";
import type { PolicyDecision } from "./policy";

export type RoutingSignalSource = "benchmark" | "catalog";

export interface ProviderCandidateScoreBreakdown {
  quality: number;
  cost: number;
  performance: number;
  weightedTotal: number;
}

export interface ProviderCandidateSignalSources {
  quality: RoutingSignalSource;
  cost: RoutingSignalSource;
  performance: RoutingSignalSource;
}

export interface RoutingWarning {
  code: string;
  message: string;
  metadata?: JsonObject;
}

export interface ProviderCandidate {
  provider: ProviderName;
  model: string;
  capabilityClass?: CapabilityClass;
  costTier?: CostTier;
  latencyTier?: LatencyTier;
  score?: number;
  scoreBreakdown?: ProviderCandidateScoreBreakdown;
  signalSources?: ProviderCandidateSignalSources;
  rationale?: string[];
}

export interface ExcludedProviderCandidate {
  provider: ProviderName;
  model: string;
  reasonCode: string;
  reasonText: string;
}

interface RoutingDecisionBase {
  selectionReasonCode: string;
  selectionReasonText: string;
  benchmarkSource?: BenchmarkSourceName;
  benchmarkTimestamp?: string;
  fallbacksUsed?: string[];
  excludedCandidates?: ExcludedProviderCandidate[];
  routingProfileId?: string;
  policyDecisions?: PolicyDecision[];
  warnings?: RoutingWarning[];
}

export interface SelectedRoutingDecision extends RoutingDecisionBase {
  outcome: "selected";
  selected: ProviderCandidate;
  alternatives?: ProviderCandidate[];
}

export interface BlockedRoutingDecision extends RoutingDecisionBase {
  outcome: "blocked";
}

export type RoutingDecision = SelectedRoutingDecision | BlockedRoutingDecision;
