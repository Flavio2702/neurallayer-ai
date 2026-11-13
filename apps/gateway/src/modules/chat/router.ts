import type {
  CostTier,
  Mode,
  NormalizedRequest,
  PolicyDecision,
  ProviderCandidate,
  ProviderName,
  ResolvedContext,
  RoutingDecision,
  RoutingWarning,
  TaskType,
} from "@neuralayer/core";
import { PROVIDER_NAME_VALUES } from "@neuralayer/core";

import {
  getInitialModelCatalogEntriesForMode,
  getWorkspaceRecordedCostForPeriod,
  listActiveChatModelCatalogWithLatestBenchmarks,
  listActiveScopedPolicyRules,
  listActiveWorkspaceProviderAccounts,
  listInitialModelCatalogEntries,
  type RoutingCatalogBenchmarkRow,
  resolveRoutingProfileForProject,
} from "@neuralayer/db";

export interface ChatRouterInput {
  request: NormalizedRequest;
  context: ResolvedContext;
}

export interface ChatRouter {
  route(input: ChatRouterInput): Promise<RoutingDecision>;
}

export interface ChatRouterDependencies {
  loadProviderAccounts?: typeof listActiveWorkspaceProviderAccounts;
  loadPolicyRules?: typeof listActiveScopedPolicyRules;
  loadRoutingProfile?: typeof resolveRoutingProfileForProject;
  loadCatalogWithBenchmarks?: typeof listActiveChatModelCatalogWithLatestBenchmarks;
  loadRecordedCostForPeriod?: typeof getWorkspaceRecordedCostForPeriod;
  now?: () => Date;
}

type SupportedRuleType =
  | "allow_model"
  | "deny_model"
  | "allow_provider"
  | "deny_provider"
  | "budget_cap"
  | "preferred_provider";

interface PolicyContext {
  id: string;
  scope: "workspace" | "project";
  name: string;
  enforcementMode: "hard_block" | "soft_warn";
  reason: string;
}

interface NormalizedProviderPolicyRule extends PolicyContext {
  ruleType: "allow_provider" | "deny_provider";
  providers: ProviderName[];
}

interface NormalizedModelPolicyRule extends PolicyContext {
  ruleType: "allow_model" | "deny_model";
  models: string[];
}

interface NormalizedBudgetCapPolicyRule extends PolicyContext {
  ruleType: "budget_cap";
  limitUsd: number;
}

interface NormalizedPreferredProviderPolicyRule extends PolicyContext {
  ruleType: "preferred_provider";
  provider: ProviderName;
}

type NormalizedPolicyRule =
  | NormalizedProviderPolicyRule
  | NormalizedModelPolicyRule
  | NormalizedBudgetCapPolicyRule
  | NormalizedPreferredProviderPolicyRule;

interface RouterCandidate {
  provider: ProviderName;
  model: string;
  label: string;
  capabilityClasses: RoutingCatalogBenchmarkRow["model"]["capabilityClasses"];
  capabilityClass?: ProviderCandidate["capabilityClass"];
  costTier: CostTier;
  latencyTier: ProviderCandidate["latencyTier"];
  benchmark: RoutingCatalogBenchmarkRow["benchmark"];
  stableOrderRank: number;
  lexicalOrderKey: string;
  score?: number;
  scoreBreakdown?: ProviderCandidate["scoreBreakdown"];
  signalSources?: ProviderCandidate["signalSources"];
  rationale?: string[];
  costTieScore?: number;
  latencyTieScore?: number;
}

interface ScoreComponent {
  score: number;
  source: "benchmark" | "catalog";
}

const BENCHMARK_SOURCE = "artificial_analysis";
const STALE_BENCHMARK_HOURS = 7 * 24;
const TIE_THRESHOLD = 3;

const MODE_WEIGHTS: Record<
  Mode,
  {
    quality: number;
    cost: number;
    performance: number;
  }
> = {
  max_quality: {
    quality: 70,
    cost: 10,
    performance: 20,
  },
  balanced: {
    quality: 45,
    cost: 30,
    performance: 25,
  },
  budget: {
    quality: 25,
    cost: 50,
    performance: 25,
  },
};

const COST_TIER_SCORE: Record<CostTier, number> = {
  low: 90,
  medium: 60,
  high: 30,
};

const LATENCY_TIER_SCORE: Record<
  NonNullable<ProviderCandidate["latencyTier"]>,
  number
> = {
  fast: 90,
  medium: 60,
  slow: 30,
};

const CODING_TASK_TYPES = new Set<TaskType>([
  "code_generation",
  "code_review",
  "debugging",
]);

const VALID_PROVIDER_NAMES = new Set<string>(PROVIDER_NAME_VALUES);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toStringArray(value: unknown) {
  if (typeof value === "string") {
    return [value];
  }

  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === "string");
}

function toNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== "string" || value.trim().length === 0) {
    return undefined;
  }

  const parsedValue = Number(value);

  return Number.isFinite(parsedValue) ? parsedValue : undefined;
}

function toProviderName(value: unknown): ProviderName | undefined {
  if (typeof value !== "string" || !VALID_PROVIDER_NAMES.has(value)) {
    return undefined;
  }

  return value as ProviderName;
}

function toProviderNameArray(value: unknown) {
  return toStringArray(value)
    .map((entry) => toProviderName(entry))
    .filter((entry): entry is ProviderName => typeof entry !== "undefined");
}

function matchesPolicyWhen(
  conditionsJson: Record<string, unknown>,
  request: NormalizedRequest,
) {
  const when = isRecord(conditionsJson.when) ? conditionsJson.when : undefined;

  if (!when) {
    return true;
  }

  const modes = toStringArray(when.modes);

  if (modes.length > 0 && !modes.includes(request.mode)) {
    return false;
  }

  const taskTypes = toStringArray(when.taskTypes ?? when.task_types);

  if (taskTypes.length > 0 && !request.taskType) {
    return false;
  }

  if (
    taskTypes.length > 0 &&
    request.taskType &&
    !taskTypes.includes(request.taskType)
  ) {
    return false;
  }

  return true;
}

function getPolicyScope(projectId?: string | null): PolicyContext["scope"] {
  return projectId ? "project" : "workspace";
}

function getPolicyReason(
  conditionsJson: Record<string, unknown>,
  fallback: string,
) {
  return typeof conditionsJson.reason === "string"
    ? conditionsJson.reason
    : fallback;
}

function normalizePolicyRule(
  rule: Awaited<ReturnType<typeof listActiveScopedPolicyRules>>[number],
  request: NormalizedRequest,
): NormalizedPolicyRule | null {
  if (!matchesPolicyWhen(rule.conditionsJson, request)) {
    return null;
  }

  const baseContext: PolicyContext = {
    id: rule.id,
    scope: getPolicyScope(rule.projectId),
    name: rule.name,
    enforcementMode: rule.enforcementMode,
    reason: getPolicyReason(rule.conditionsJson, rule.name),
  };

  switch (rule.ruleType as SupportedRuleType) {
    case "allow_provider":
    case "deny_provider": {
      const providers = [
        ...new Set(
          toProviderNameArray(rule.conditionsJson.providers).concat(
            toProviderName(rule.conditionsJson.provider)
              ? [toProviderName(rule.conditionsJson.provider)!]
              : [],
          ),
        ),
      ];

      if (providers.length === 0) {
        return null;
      }

      return {
        ...baseContext,
        ruleType:
          rule.ruleType === "allow_provider"
            ? "allow_provider"
            : "deny_provider",
        providers,
      };
    }
    case "allow_model":
    case "deny_model": {
      const models = [
        ...new Set(
          toStringArray(rule.conditionsJson.models).concat(
            typeof rule.conditionsJson.model === "string"
              ? [rule.conditionsJson.model]
              : [],
          ),
        ),
      ];

      if (models.length === 0) {
        return null;
      }

      return {
        ...baseContext,
        ruleType:
          rule.ruleType === "allow_model" ? "allow_model" : "deny_model",
        models,
      };
    }
    case "budget_cap": {
      const limitUsd = toNumber(rule.conditionsJson.limitUsd);

      if (typeof limitUsd !== "number" || limitUsd < 0) {
        return null;
      }

      return {
        ...baseContext,
        ruleType: "budget_cap",
        limitUsd,
      };
    }
    case "preferred_provider": {
      const provider = toProviderName(rule.conditionsJson.provider);

      if (!provider) {
        return null;
      }

      return {
        ...baseContext,
        ruleType: "preferred_provider",
        provider,
      };
    }
    default:
      return null;
  }
}

function createPolicyDecision(
  rule: PolicyContext,
  input: {
    type: PolicyDecision["type"];
    reasonCode: string;
    message: string;
    metadata?: Record<string, unknown>;
  },
): PolicyDecision {
  return {
    type: input.type,
    enforcementMode: rule.enforcementMode,
    reasonCode: input.reasonCode,
    message: input.message,
    metadata: {
      policy_rule_id: rule.id,
      policy_scope: rule.scope,
      policy_name: rule.name,
      ...(input.metadata ?? {}),
    },
  };
}

function getPrimaryCapabilityClass(
  capabilityClasses: string[],
  taskType?: TaskType,
): ProviderCandidate["capabilityClass"] {
  if (
    taskType &&
    CODING_TASK_TYPES.has(taskType) &&
    capabilityClasses.includes("coding")
  ) {
    return "coding";
  }

  if (capabilityClasses.includes("general")) {
    return "general";
  }

  if (capabilityClasses.includes("reasoning")) {
    return "reasoning";
  }

  if (capabilityClasses.includes("coding")) {
    return "coding";
  }

  return undefined;
}

function getQualityFallbackScore(
  candidate: RouterCandidate,
  taskType?: TaskType,
) {
  const hasGeneral = candidate.capabilityClasses.includes("general");
  const hasCoding = candidate.capabilityClasses.includes("coding");
  const hasReasoning = candidate.capabilityClasses.includes("reasoning");

  if (taskType && CODING_TASK_TYPES.has(taskType)) {
    let score = hasCoding ? 82 : hasGeneral ? 55 : 30;

    if (hasReasoning) {
      score += 8;
    }

    return score;
  }

  let score = hasGeneral ? 80 : hasCoding ? 60 : 30;

  if (hasReasoning) {
    score += 5;
  }

  return score;
}

function getBenchmarkCostValue(candidate: RouterCandidate) {
  const inputPrice = candidate.benchmark?.priceInputPer1mTokensUsd;
  const outputPrice = candidate.benchmark?.priceOutputPer1mTokensUsd;

  if (typeof inputPrice !== "number" && typeof outputPrice !== "number") {
    return undefined;
  }

  return (inputPrice ?? 0) + (outputPrice ?? 0);
}

function getBenchmarkQualityValue(
  candidate: RouterCandidate,
  taskType?: TaskType,
) {
  if (taskType && CODING_TASK_TYPES.has(taskType)) {
    return candidate.benchmark?.qualityCodingScore;
  }

  return candidate.benchmark?.qualityGeneralScore;
}

function normalizeHigherBetter(value: number, values: number[]) {
  if (values.length === 0) {
    return 100;
  }

  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);

  if (minValue === maxValue) {
    return 100;
  }

  return Math.round(((value - minValue) / (maxValue - minValue)) * 100);
}

function normalizeLowerBetter(value: number, values: number[]) {
  if (values.length === 0) {
    return 100;
  }

  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);

  if (minValue === maxValue) {
    return 100;
  }

  return Math.round(((maxValue - value) / (maxValue - minValue)) * 100);
}

function scoreQuality(
  candidates: RouterCandidate[],
  taskType?: TaskType,
): Map<string, ScoreComponent> {
  const benchmarkValues = candidates
    .map((candidate) => getBenchmarkQualityValue(candidate, taskType))
    .filter((value): value is number => typeof value === "number");
  const scores = new Map<string, ScoreComponent>();

  for (const candidate of candidates) {
    const benchmarkValue = getBenchmarkQualityValue(candidate, taskType);

    if (typeof benchmarkValue === "number") {
      scores.set(candidate.lexicalOrderKey, {
        score: normalizeHigherBetter(benchmarkValue, benchmarkValues),
        source: "benchmark",
      });
      continue;
    }

    scores.set(candidate.lexicalOrderKey, {
      score: Math.round(getQualityFallbackScore(candidate, taskType)),
      source: "catalog",
    });
  }

  return scores;
}

function scoreCost(candidates: RouterCandidate[]) {
  const benchmarkValues = candidates
    .map((candidate) => getBenchmarkCostValue(candidate))
    .filter((value): value is number => typeof value === "number");
  const scores = new Map<string, ScoreComponent>();

  for (const candidate of candidates) {
    const benchmarkValue = getBenchmarkCostValue(candidate);

    if (typeof benchmarkValue === "number") {
      scores.set(candidate.lexicalOrderKey, {
        score: normalizeLowerBetter(benchmarkValue, benchmarkValues),
        source: "benchmark",
      });
      continue;
    }

    scores.set(candidate.lexicalOrderKey, {
      score: COST_TIER_SCORE[candidate.costTier],
      source: "catalog",
    });
  }

  return scores;
}

function scorePerformance(candidates: RouterCandidate[]) {
  const throughputValues = candidates
    .map((candidate) => candidate.benchmark?.outputTokensPerSecond)
    .filter((value): value is number => typeof value === "number");
  const latencyValues = candidates
    .map((candidate) => candidate.benchmark?.timeToFirstTokenMs)
    .filter((value): value is number => typeof value === "number");
  const scores = new Map<string, ScoreComponent>();

  for (const candidate of candidates) {
    const throughput = candidate.benchmark?.outputTokensPerSecond;
    const latency = candidate.benchmark?.timeToFirstTokenMs;
    const componentScores: number[] = [];

    if (typeof throughput === "number") {
      componentScores.push(normalizeHigherBetter(throughput, throughputValues));
    }

    if (typeof latency === "number") {
      componentScores.push(normalizeLowerBetter(latency, latencyValues));
    }

    if (componentScores.length > 0) {
      scores.set(candidate.lexicalOrderKey, {
        score: Math.round(
          componentScores.reduce((sum, value) => sum + value, 0) /
            componentScores.length,
        ),
        source: "benchmark",
      });
      continue;
    }

    scores.set(candidate.lexicalOrderKey, {
      score: LATENCY_TIER_SCORE[candidate.latencyTier ?? "medium"],
      source: "catalog",
    });
  }

  return scores;
}

function buildCandidateRationale(input: {
  mode: Mode;
  score: number;
  quality: ScoreComponent;
  cost: ScoreComponent;
  performance: ScoreComponent;
}) {
  return [
    `Final ${input.mode} score: ${input.score}/100.`,
    `Quality ${input.quality.score} (${input.quality.source}), cost ${input.cost.score} (${input.cost.source}), performance ${input.performance.score} (${input.performance.source}).`,
  ];
}

function applyScores(
  candidates: RouterCandidate[],
  request: NormalizedRequest,
): RouterCandidate[] {
  const weights = MODE_WEIGHTS[request.mode];
  const qualityScores = scoreQuality(candidates, request.taskType);
  const costScores = scoreCost(candidates);
  const performanceScores = scorePerformance(candidates);

  return candidates.map((candidate) => {
    const quality = qualityScores.get(candidate.lexicalOrderKey) ?? {
      score: 0,
      source: "catalog" as const,
    };
    const cost = costScores.get(candidate.lexicalOrderKey) ?? {
      score: COST_TIER_SCORE[candidate.costTier],
      source: "catalog" as const,
    };
    const performance = performanceScores.get(candidate.lexicalOrderKey) ?? {
      score: LATENCY_TIER_SCORE[candidate.latencyTier ?? "medium"],
      source: "catalog" as const,
    };
    const weightedTotal = Math.round(
      (quality.score * weights.quality +
        cost.score * weights.cost +
        performance.score * weights.performance) /
        100,
    );

    return {
      ...candidate,
      score: weightedTotal,
      scoreBreakdown: {
        quality: quality.score,
        cost: cost.score,
        performance: performance.score,
        weightedTotal,
      },
      signalSources: {
        quality: quality.source,
        cost: cost.source,
        performance: performance.source,
      },
      rationale: buildCandidateRationale({
        mode: request.mode,
        score: weightedTotal,
        quality,
        cost,
        performance,
      }),
      costTieScore: cost.score,
      latencyTieScore:
        performance.source === "benchmark"
          ? performance.score
          : LATENCY_TIER_SCORE[candidate.latencyTier ?? "medium"],
    };
  });
}

function compareStableOrder(a: RouterCandidate, b: RouterCandidate) {
  if (a.stableOrderRank !== b.stableOrderRank) {
    return a.stableOrderRank - b.stableOrderRank;
  }

  return a.lexicalOrderKey.localeCompare(b.lexicalOrderKey);
}

function compareByScore(a: RouterCandidate, b: RouterCandidate) {
  const scoreDifference = (b.score ?? 0) - (a.score ?? 0);

  if (scoreDifference !== 0) {
    return scoreDifference;
  }

  return compareStableOrder(a, b);
}

function selectPreferredProvider(
  rules: NormalizedPreferredProviderPolicyRule[],
): ProviderName | undefined {
  const projectRule = rules.find((rule) => rule.scope === "project");

  if (projectRule) {
    return projectRule.provider;
  }

  return rules[0]?.provider;
}

function getMonthRange(now: Date) {
  return {
    start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
    end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
  };
}

function buildStableOrderLookup(
  routingProfileRulesJson: Record<string, unknown> | undefined,
  mode: Mode,
) {
  const candidatesByMode = routingProfileRulesJson
    ? isRecord(routingProfileRulesJson.candidatesByMode)
      ? routingProfileRulesJson.candidatesByMode
      : undefined
    : undefined;
  const modeCandidates = candidatesByMode ? candidatesByMode[mode] : undefined;

  if (!Array.isArray(modeCandidates)) {
    return new Map<string, number>();
  }

  const lookup = new Map<string, number>();

  for (const [index, candidate] of modeCandidates.entries()) {
    if (!isRecord(candidate)) {
      continue;
    }

    const provider = toProviderName(candidate.provider);
    const modelId =
      typeof candidate.modelId === "string" ? candidate.modelId : undefined;

    if (!provider || !modelId) {
      continue;
    }

    lookup.set(`${provider}:${modelId}`, index);
  }

  return lookup;
}

function createExcludedCandidate(
  candidate: RouterCandidate,
  reasonCode: string,
  reasonText: string,
) {
  return {
    provider: candidate.provider,
    model: candidate.model,
    reasonCode,
    reasonText,
  };
}

function toProviderCandidate(candidate: RouterCandidate): ProviderCandidate {
  return {
    provider: candidate.provider,
    model: candidate.model,
    capabilityClass: candidate.capabilityClass,
    costTier: candidate.costTier,
    latencyTier: candidate.latencyTier,
    score: candidate.score,
    scoreBreakdown: candidate.scoreBreakdown,
    signalSources: candidate.signalSources,
    rationale: candidate.rationale,
  };
}

function hasAnyBenchmarkSignal(candidates: RouterCandidate[]) {
  return candidates.some((candidate) =>
    Object.values(candidate.signalSources ?? {}).includes("benchmark"),
  );
}

function createBudgetBlockedDecision(
  rule: NormalizedBudgetCapPolicyRule,
  currentSpendUsd: number,
  routingProfileId?: string,
): RoutingDecision {
  return {
    outcome: "blocked",
    selectionReasonCode: "policy_blocked_budget_cap",
    selectionReasonText:
      "Blocked because the workspace monthly gateway-recorded budget cap has already been reached.",
    routingProfileId,
    policyDecisions: [
      createPolicyDecision(rule, {
        type: "block",
        reasonCode: "policy_blocked_budget_cap",
        message:
          "The workspace monthly budget cap is already exhausted for this request.",
        metadata: {
          current_spend_usd: currentSpendUsd,
          limit_usd: rule.limitUsd,
        },
      }),
    ],
  };
}

function chooseWinner(
  tiedCandidates: RouterCandidate[],
  preferredProvider: ProviderName | undefined,
): {
  selected: RouterCandidate;
  reasonCode: string;
  reasonText: string;
} {
  const fallbackCandidate = tiedCandidates[0];

  if (!fallbackCandidate) {
    throw new Error("Cannot choose a winner without tied candidates.");
  }

  const lowerCostWinners = tiedCandidates.slice().sort((left, right) => {
    const scoreDifference =
      (right.costTieScore ?? 0) - (left.costTieScore ?? 0);

    if (scoreDifference !== 0) {
      return scoreDifference;
    }

    return compareStableOrder(left, right);
  });
  const bestCostScore = lowerCostWinners[0]?.costTieScore ?? 0;
  const bestCostCandidates = lowerCostWinners.filter(
    (candidate) => (candidate.costTieScore ?? 0) === bestCostScore,
  );

  const bestCostCandidate = bestCostCandidates[0];

  if (bestCostCandidates.length === 1 && bestCostCandidate) {
    return {
      selected: bestCostCandidate,
      reasonCode: "lower_cost_tiebreak",
      reasonText: `Selected ${bestCostCandidate.provider}/${bestCostCandidate.model} because the top candidates were within ${TIE_THRESHOLD} points and this option had the lower cost.`,
    };
  }

  const preferredCandidate = preferredProvider
    ? bestCostCandidates.find(
        (candidate) => candidate.provider === preferredProvider,
      )
    : undefined;

  if (preferredCandidate) {
    return {
      selected: preferredCandidate,
      reasonCode: "preferred_provider_tiebreak",
      reasonText: `Selected ${preferredCandidate.provider}/${preferredCandidate.model} because the top candidates were within ${TIE_THRESHOLD} points and the preferred provider remained eligible.`,
    };
  }

  const lowerLatencyWinners = bestCostCandidates.slice().sort((left, right) => {
    const scoreDifference =
      (right.latencyTieScore ?? 0) - (left.latencyTieScore ?? 0);

    if (scoreDifference !== 0) {
      return scoreDifference;
    }

    return compareStableOrder(left, right);
  });
  const bestLatencyScore = lowerLatencyWinners[0]?.latencyTieScore ?? 0;
  const bestLatencyCandidates = lowerLatencyWinners.filter(
    (candidate) => (candidate.latencyTieScore ?? 0) === bestLatencyScore,
  );

  const bestLatencyCandidate = bestLatencyCandidates[0];

  if (bestLatencyCandidates.length === 1 && bestLatencyCandidate) {
    return {
      selected: bestLatencyCandidate,
      reasonCode: "lower_latency_tiebreak",
      reasonText: `Selected ${bestLatencyCandidate.provider}/${bestLatencyCandidate.model} because the top candidates were within ${TIE_THRESHOLD} points and this option had the lower latency.`,
    };
  }

  const stableCandidate =
    bestLatencyCandidates.slice().sort(compareStableOrder)[0] ??
    bestCostCandidate ??
    fallbackCandidate;

  return {
    selected: stableCandidate,
    reasonCode: "stable_order_tiebreak",
    reasonText: `Selected ${stableCandidate.provider}/${stableCandidate.model} because the top candidates were within ${TIE_THRESHOLD} points and the deterministic stable order resolved the tie.`,
  };
}

function buildReasonForSingleWinner(
  candidate: RouterCandidate,
  request: NormalizedRequest,
  eligibleCandidates: RouterCandidate[],
) {
  if (eligibleCandidates.length === 1) {
    return {
      code: "only_eligible_candidate",
      text: `Selected ${candidate.provider}/${candidate.model} because it was the only eligible candidate after policy evaluation.`,
    };
  }

  if (!hasAnyBenchmarkSignal(eligibleCandidates)) {
    return {
      code: "catalog_fallback_no_benchmark",
      text: `Selected ${candidate.provider}/${candidate.model} because benchmark signals were unavailable and the router used catalog fallbacks for ${request.mode}.`,
    };
  }

  return {
    code: "best_score_for_mode",
    text: `Selected ${candidate.provider}/${candidate.model} because it had the best ${request.mode} score across policy-eligible candidates.`,
  };
}

export function createBootstrapChatRouter(): ChatRouter {
  return {
    async route(input) {
      const modeEntries = getInitialModelCatalogEntriesForMode(
        input.request.mode,
      );
      const fallbackEntries = listInitialModelCatalogEntries();
      const selectedEntry = modeEntries[0] ?? fallbackEntries[0];

      if (!selectedEntry) {
        return {
          outcome: "blocked",
          selectionReasonCode: "policy_blocked_no_eligible_candidate",
          selectionReasonText:
            "No eligible provider candidate is available in the bootstrap catalog.",
        };
      }

      return {
        outcome: "selected",
        selected: {
          provider: selectedEntry.provider,
          model: selectedEntry.modelId,
          capabilityClass: selectedEntry.capabilityClasses[0],
          costTier: selectedEntry.costTier,
          latencyTier: selectedEntry.latencyTier,
        },
        alternatives: (modeEntries.length > 0 ? modeEntries : fallbackEntries)
          .slice(1)
          .map((entry) => ({
            provider: entry.provider,
            model: entry.modelId,
            capabilityClass: entry.capabilityClasses[0],
            costTier: entry.costTier,
            latencyTier: entry.latencyTier,
          })),
        selectionReasonCode: "catalog_fallback_no_benchmark",
        selectionReasonText: `Selected the first deterministic ${input.request.mode} candidate from the bootstrap model catalog because benchmark-informed routing is not wired yet.`,
        fallbacksUsed: ["bootstrap_catalog"],
      };
    },
  };
}

export function createDatabaseChatRouter(
  dependencies: ChatRouterDependencies = {},
): ChatRouter {
  const loadProviderAccounts =
    dependencies.loadProviderAccounts ?? listActiveWorkspaceProviderAccounts;
  const loadPolicyRules =
    dependencies.loadPolicyRules ?? listActiveScopedPolicyRules;
  const loadRoutingProfile =
    dependencies.loadRoutingProfile ?? resolveRoutingProfileForProject;
  const loadCatalogWithBenchmarks =
    dependencies.loadCatalogWithBenchmarks ??
    listActiveChatModelCatalogWithLatestBenchmarks;
  const loadRecordedCostForPeriod =
    dependencies.loadRecordedCostForPeriod ?? getWorkspaceRecordedCostForPeriod;
  const now = dependencies.now ?? (() => new Date());

  return {
    async route(input) {
      const requestTime = now();
      const [providerAccountRows, policyRuleRows, routingProfile] =
        await Promise.all([
          loadProviderAccounts(input.context.workspaceId),
          loadPolicyRules({
            workspaceId: input.context.workspaceId,
            projectId: input.context.projectId,
          }),
          loadRoutingProfile({
            workspaceId: input.context.workspaceId,
            projectId: input.context.projectId,
          }),
        ]);

      const configuredProviders = [
        ...new Set(providerAccountRows.map((account) => account.provider)),
      ];
      const catalogResult = await loadCatalogWithBenchmarks({
        sourceName: BENCHMARK_SOURCE,
        providers: configuredProviders,
      });
      const stableOrderLookup = buildStableOrderLookup(
        routingProfile?.rulesJson,
        input.request.mode,
      );
      const warnings: RoutingWarning[] = [];
      const policyDecisions: PolicyDecision[] = [];
      const fallbacksUsed = new Set<string>();

      if (catalogResult.snapshot) {
        const snapshotAgeHours =
          (requestTime.valueOf() -
            new Date(catalogResult.snapshot.syncedAt).valueOf()) /
          (1000 * 60 * 60);

        if (snapshotAgeHours > STALE_BENCHMARK_HOURS) {
          warnings.push({
            code: "benchmark_snapshot_stale",
            message:
              "The latest local benchmark snapshot is older than 7 days, so routing continued with a staleness warning.",
            metadata: {
              benchmark_source: catalogResult.snapshot.sourceName,
              benchmark_timestamp: catalogResult.snapshot.syncedAt,
              age_hours: Math.round(snapshotAgeHours),
            },
          });
        }
      }

      let candidates: RouterCandidate[] = catalogResult.rows.map(
        (row): RouterCandidate => {
          const lexicalOrderKey = `${row.model.provider}:${row.model.modelId}`;

          return {
            provider: row.model.provider,
            model: row.model.modelId,
            label: row.model.label,
            capabilityClasses: row.model.capabilityClasses,
            capabilityClass: getPrimaryCapabilityClass(
              row.model.capabilityClasses,
              input.request.taskType,
            ),
            costTier: row.model.costTier,
            latencyTier: row.model.latencyTier,
            benchmark: row.benchmark,
            stableOrderRank:
              stableOrderLookup.get(lexicalOrderKey) ?? Number.MAX_SAFE_INTEGER,
            lexicalOrderKey,
          } satisfies RouterCandidate;
        },
      );
      const excludedCandidates: NonNullable<
        RoutingDecision["excludedCandidates"]
      > = [];

      if (candidates.length === 0) {
        return {
          outcome: "blocked",
          selectionReasonCode: "policy_blocked_no_eligible_candidate",
          selectionReasonText:
            "Blocked because no active chat-capable model is available for the configured workspace providers.",
          routingProfileId: routingProfile?.id,
          benchmarkSource: catalogResult.snapshot?.sourceName,
          benchmarkTimestamp: catalogResult.snapshot?.syncedAt,
          warnings,
        };
      }

      const normalizedRules = policyRuleRows
        .map((rule) => normalizePolicyRule(rule, input.request))
        .filter((rule): rule is NormalizedPolicyRule => rule !== null);
      const hardProviderDenyRules = normalizedRules.filter(
        (rule): rule is NormalizedProviderPolicyRule =>
          rule.ruleType === "deny_provider" &&
          rule.enforcementMode === "hard_block",
      );
      const hardModelDenyRules = normalizedRules.filter(
        (rule): rule is NormalizedModelPolicyRule =>
          rule.ruleType === "deny_model" &&
          rule.enforcementMode === "hard_block",
      );
      const hardProviderAllowRules = normalizedRules.filter(
        (rule): rule is NormalizedProviderPolicyRule =>
          rule.ruleType === "allow_provider" &&
          rule.enforcementMode === "hard_block",
      );
      const hardModelAllowRules = normalizedRules.filter(
        (rule): rule is NormalizedModelPolicyRule =>
          rule.ruleType === "allow_model" &&
          rule.enforcementMode === "hard_block",
      );
      const hardBudgetCapRules = normalizedRules.filter(
        (rule): rule is NormalizedBudgetCapPolicyRule =>
          rule.ruleType === "budget_cap" &&
          rule.enforcementMode === "hard_block",
      );
      const preferredProviderRules = normalizedRules.filter(
        (rule): rule is NormalizedPreferredProviderPolicyRule =>
          rule.ruleType === "preferred_provider",
      );

      for (const rule of normalizedRules) {
        if (rule.ruleType === "preferred_provider") {
          policyDecisions.push(
            createPolicyDecision(rule, {
              type: "warn",
              reasonCode: "preferred_provider",
              message: `Preferred provider ${rule.provider} can influence tie-breaks when multiple candidates remain within ${TIE_THRESHOLD} points.`,
              metadata: {
                preferred_provider: rule.provider,
              },
            }),
          );
          continue;
        }

        if (rule.enforcementMode === "soft_warn") {
          policyDecisions.push(
            createPolicyDecision(rule, {
              type: "warn",
              reasonCode: `${rule.ruleType}_soft_warn`,
              message: `Soft warning policy "${rule.name}" matched this request without changing eligibility.`,
            }),
          );
        }
      }

      for (const rule of hardProviderDenyRules) {
        const deniedProviders = new Set(rule.providers);
        const nextCandidates: RouterCandidate[] = [];

        for (const candidate of candidates) {
          if (!deniedProviders.has(candidate.provider)) {
            nextCandidates.push(candidate);
            continue;
          }

          excludedCandidates.push(
            createExcludedCandidate(
              candidate,
              "policy_denied_provider",
              `Excluded because provider ${candidate.provider} is denied by policy "${rule.name}".`,
            ),
          );
        }

        if (nextCandidates.length !== candidates.length) {
          policyDecisions.push(
            createPolicyDecision(rule, {
              type: "block",
              reasonCode: "deny_provider",
              message: `Denied providers removed ${candidates.length - nextCandidates.length} candidate(s) from routing.`,
              metadata: {
                denied_providers: rule.providers,
              },
            }),
          );
        }

        candidates = nextCandidates;
      }

      for (const rule of hardModelDenyRules) {
        const deniedModels = new Set(rule.models);
        const nextCandidates: RouterCandidate[] = [];

        for (const candidate of candidates) {
          if (!deniedModels.has(candidate.model)) {
            nextCandidates.push(candidate);
            continue;
          }

          excludedCandidates.push(
            createExcludedCandidate(
              candidate,
              "policy_denied_model",
              `Excluded because model ${candidate.model} is denied by policy "${rule.name}".`,
            ),
          );
        }

        if (nextCandidates.length !== candidates.length) {
          policyDecisions.push(
            createPolicyDecision(rule, {
              type: "block",
              reasonCode: "deny_model",
              message: `Denied models removed ${candidates.length - nextCandidates.length} candidate(s) from routing.`,
              metadata: {
                denied_models: rule.models,
              },
            }),
          );
        }

        candidates = nextCandidates;
      }

      if (hardProviderAllowRules.length > 0) {
        const firstAllowProviderRule = hardProviderAllowRules[0];
        const allowedProviders = new Set(
          hardProviderAllowRules.flatMap((rule) => rule.providers),
        );
        const nextCandidates = candidates.filter((candidate) =>
          allowedProviders.has(candidate.provider),
        );

        for (const candidate of candidates) {
          if (allowedProviders.has(candidate.provider)) {
            continue;
          }

          excludedCandidates.push(
            createExcludedCandidate(
              candidate,
              "policy_allow_provider_restricted",
              `Excluded because provider ${candidate.provider} is outside the active allow-list.`,
            ),
          );
        }

        if (firstAllowProviderRule) {
          policyDecisions.push(
            createPolicyDecision(firstAllowProviderRule, {
              type: "block",
              reasonCode: "allow_provider",
              message:
                "Provider allow-list narrowed the routing candidate set.",
              metadata: {
                allowed_providers: [...allowedProviders],
              },
            }),
          );
        }

        candidates = nextCandidates;
      }

      if (hardModelAllowRules.length > 0) {
        const firstAllowModelRule = hardModelAllowRules[0];
        const allowedModels = new Set(
          hardModelAllowRules.flatMap((rule) => rule.models),
        );
        const nextCandidates = candidates.filter((candidate) =>
          allowedModels.has(candidate.model),
        );

        for (const candidate of candidates) {
          if (allowedModels.has(candidate.model)) {
            continue;
          }

          excludedCandidates.push(
            createExcludedCandidate(
              candidate,
              "policy_allow_model_restricted",
              `Excluded because model ${candidate.model} is outside the active allow-list.`,
            ),
          );
        }

        if (firstAllowModelRule) {
          policyDecisions.push(
            createPolicyDecision(firstAllowModelRule, {
              type: "block",
              reasonCode: "allow_model",
              message: "Model allow-list narrowed the routing candidate set.",
              metadata: {
                allowed_models: [...allowedModels],
              },
            }),
          );
        }

        candidates = nextCandidates;
      }

      if (candidates.length === 0) {
        return {
          outcome: "blocked",
          selectionReasonCode: "policy_blocked_no_eligible_candidate",
          selectionReasonText:
            "Blocked because policy rules left no eligible provider/model candidate for this request.",
          benchmarkSource: catalogResult.snapshot?.sourceName,
          benchmarkTimestamp: catalogResult.snapshot?.syncedAt,
          excludedCandidates,
          routingProfileId: routingProfile?.id,
          policyDecisions,
          warnings,
        };
      }

      if (hardBudgetCapRules.length > 0) {
        const effectiveBudgetCapRule = hardBudgetCapRules.reduce(
          (lowest, rule) => (rule.limitUsd < lowest.limitUsd ? rule : lowest),
        );
        const monthRange = getMonthRange(requestTime);
        const recordedCost = await loadRecordedCostForPeriod({
          workspaceId: input.context.workspaceId,
          start: monthRange.start,
          end: monthRange.end,
        });

        if (recordedCost.totalCostUsd >= effectiveBudgetCapRule.limitUsd) {
          return createBudgetBlockedDecision(
            effectiveBudgetCapRule,
            recordedCost.totalCostUsd,
            routingProfile?.id,
          );
        }

        policyDecisions.push(
          createPolicyDecision(effectiveBudgetCapRule, {
            type: "allow",
            reasonCode: "budget_cap_checked",
            message:
              "The workspace monthly budget cap was checked before ranking and remains under the configured limit.",
            metadata: {
              current_spend_usd: recordedCost.totalCostUsd,
              limit_usd: effectiveBudgetCapRule.limitUsd,
            },
          }),
        );
      }

      candidates = applyScores(candidates, input.request);

      for (const candidate of candidates) {
        if (candidate.signalSources?.quality === "catalog") {
          fallbacksUsed.add("catalog_quality_fallback");
        }

        if (candidate.signalSources?.cost === "catalog") {
          fallbacksUsed.add("catalog_cost_fallback");
        }

        if (candidate.signalSources?.performance === "catalog") {
          fallbacksUsed.add("catalog_performance_fallback");
        }
      }

      const rankedCandidates = candidates.slice().sort(compareByScore);
      const bestCandidate = rankedCandidates[0];

      if (!bestCandidate) {
        return {
          outcome: "blocked",
          selectionReasonCode: "policy_blocked_no_eligible_candidate",
          selectionReasonText:
            "Blocked because the router could not score any eligible candidate.",
          benchmarkSource: catalogResult.snapshot?.sourceName,
          benchmarkTimestamp: catalogResult.snapshot?.syncedAt,
          excludedCandidates,
          routingProfileId: routingProfile?.id,
          policyDecisions,
          warnings,
        };
      }

      const topCandidates = rankedCandidates.filter(
        (candidate) =>
          (bestCandidate.score ?? 0) - (candidate.score ?? 0) <= TIE_THRESHOLD,
      );
      const preferredProvider = selectPreferredProvider(preferredProviderRules);
      const singleWinnerReason = buildReasonForSingleWinner(
        bestCandidate,
        input.request,
        rankedCandidates,
      );
      const selection =
        topCandidates.length > 1
          ? chooseWinner(topCandidates, preferredProvider)
          : {
              selected: bestCandidate,
              reasonCode: singleWinnerReason.code,
              reasonText: singleWinnerReason.text,
            };

      if (selection.reasonCode === "stable_order_tiebreak") {
        fallbacksUsed.add("stable_order");
      }

      const selectedCandidate = selection.selected;
      const alternatives = rankedCandidates
        .filter(
          (candidate) =>
            !(
              candidate.provider === selectedCandidate.provider &&
              candidate.model === selectedCandidate.model
            ),
        )
        .map(toProviderCandidate);

      return {
        outcome: "selected",
        selected: toProviderCandidate(selectedCandidate),
        alternatives,
        selectionReasonCode: selection.reasonCode,
        selectionReasonText: selection.reasonText,
        benchmarkSource: catalogResult.snapshot?.sourceName,
        benchmarkTimestamp: catalogResult.snapshot?.syncedAt,
        fallbacksUsed: [...fallbacksUsed],
        excludedCandidates,
        routingProfileId: routingProfile?.id,
        policyDecisions,
        warnings,
      };
    },
  };
}
