import assert from "node:assert/strict";
import { test } from "node:test";

import type {
  NormalizedRequest,
  ResolvedContext,
  RoutingDecision,
} from "@neuralayer/core";
import type {
  listActiveChatModelCatalogWithLatestBenchmarks,
  listActiveScopedPolicyRules,
  listActiveWorkspaceProviderAccounts,
  resolveRoutingProfileForProject,
} from "@neuralayer/db";

import { createDatabaseChatRouter } from "./router";

type ProviderAccountRow = Awaited<
  ReturnType<typeof listActiveWorkspaceProviderAccounts>
>[number];
type PolicyRuleRow = Awaited<
  ReturnType<typeof listActiveScopedPolicyRules>
>[number];
type RoutingProfileRow = Awaited<
  ReturnType<typeof resolveRoutingProfileForProject>
>;
type CatalogResult = Awaited<
  ReturnType<typeof listActiveChatModelCatalogWithLatestBenchmarks>
>;

const BASE_REQUEST: NormalizedRequest = {
  stream: false,
  messages: [
    {
      role: "user",
      content: "Route this request.",
    },
  ],
  mode: "balanced",
  source: "api",
  requestId: "req_router",
  projectId: "proj_router",
  taskType: "general",
};

const BASE_CONTEXT: ResolvedContext = {
  workspaceId: "ws_router",
  projectId: "proj_router",
  mode: "balanced",
  source: "api",
  requestId: "req_router",
  apiKeyId: "gak_router",
  taskType: "general",
};

const PROVIDER_ACCOUNTS: ProviderAccountRow[] = [
  {
    id: "provacc_openai",
    workspaceId: "ws_router",
    provider: "openai",
    displayName: "OpenAI",
  },
  {
    id: "provacc_anthropic",
    workspaceId: "ws_router",
    provider: "anthropic",
    displayName: "Anthropic",
  },
];

function assertSelected(
  decision: RoutingDecision,
): asserts decision is Extract<RoutingDecision, { outcome: "selected" }> {
  assert.equal(decision.outcome, "selected");
}

function assertBlocked(
  decision: RoutingDecision,
): asserts decision is Extract<RoutingDecision, { outcome: "blocked" }> {
  assert.equal(decision.outcome, "blocked");
}

function createCatalogResult(
  overrides: {
    snapshotSyncedAt?: string | null;
    rows?: CatalogResult["rows"];
  } = {},
): CatalogResult {
  const snapshotSyncedAt =
    typeof overrides.snapshotSyncedAt === "undefined"
      ? "2026-03-23T00:00:00.000Z"
      : overrides.snapshotSyncedAt;

  return {
    snapshot: snapshotSyncedAt
      ? {
          sourceName: "artificial_analysis",
          syncedAt: snapshotSyncedAt,
        }
      : null,
    rows: overrides.rows ?? [
      createCatalogRow({
        provider: "openai",
        modelId: "gpt-5.2",
        label: "OpenAI GPT-5.2",
        costTier: "high",
        benchmark: {
          sourceName: "artificial_analysis",
          syncedAt: snapshotSyncedAt ?? "2026-03-23T00:00:00.000Z",
          qualityGeneralScore: 95,
          qualityCodingScore: 92,
          priceInputPer1mTokensUsd: 20,
          priceOutputPer1mTokensUsd: 20,
          outputTokensPerSecond: 30,
          timeToFirstTokenMs: 400,
        },
      }),
      createCatalogRow({
        provider: "anthropic",
        modelId: "claude-sonnet-4-20250514",
        label: "Anthropic Claude Sonnet 4",
        costTier: "low",
        benchmark: {
          sourceName: "artificial_analysis",
          syncedAt: snapshotSyncedAt ?? "2026-03-23T00:00:00.000Z",
          qualityGeneralScore: 88,
          qualityCodingScore: 85,
          priceInputPer1mTokensUsd: 5,
          priceOutputPer1mTokensUsd: 5,
          outputTokensPerSecond: 90,
          timeToFirstTokenMs: 120,
        },
      }),
    ],
  };
}

function createCatalogRow(overrides: {
  provider: "openai" | "anthropic";
  modelId: string;
  label: string;
  costTier: "low" | "medium" | "high";
  latencyTier?: "fast" | "medium" | "slow";
  capabilityClasses?: ("general" | "coding" | "reasoning")[];
  benchmark?: CatalogResult["rows"][number]["benchmark"];
}) {
  return {
    model: {
      id: `${overrides.provider}:${overrides.modelId}`,
      provider: overrides.provider,
      modelId: overrides.modelId,
      label: overrides.label,
      capabilityClasses: overrides.capabilityClasses ?? [
        "general",
        "coding",
        "reasoning",
      ],
      costTier: overrides.costTier,
      latencyTier: overrides.latencyTier ?? "medium",
      supportsChat: true,
      supportsStreaming: true,
      isActive: true,
      status: "active" as const,
    },
    benchmark: overrides.benchmark ?? null,
  } satisfies CatalogResult["rows"][number];
}

function createPolicyRule(
  overrides: Partial<PolicyRuleRow> &
    Pick<
      PolicyRuleRow,
      "id" | "name" | "ruleType" | "enforcementMode" | "conditionsJson"
    >,
): PolicyRuleRow {
  return {
    workspaceId: "ws_router",
    projectId: null,
    ...overrides,
  };
}

function createRoutingProfile(
  rulesJson: Record<string, unknown>,
): NonNullable<RoutingProfileRow> {
  return {
    id: "rprof_router",
    rulesJson,
  };
}

function createRouterScenario(input: {
  policies?: PolicyRuleRow[];
  catalogResult?: CatalogResult;
  routingProfile?: RoutingProfileRow;
  totalCostUsd?: number;
  now?: Date;
}) {
  return createDatabaseChatRouter({
    loadProviderAccounts: async () => PROVIDER_ACCOUNTS,
    loadPolicyRules: async () => input.policies ?? [],
    loadRoutingProfile: async () => input.routingProfile ?? null,
    loadCatalogWithBenchmarks: async () =>
      input.catalogResult ?? createCatalogResult(),
    loadRecordedCostForPeriod: async () => ({
      workspaceId: "ws_router",
      start: "2026-03-01T00:00:00.000Z",
      end: "2026-04-01T00:00:00.000Z",
      totalCostUsd: input.totalCostUsd ?? 0,
    }),
    now: () => input.now ?? new Date("2026-03-23T12:00:00.000Z"),
  });
}

async function routeDecision(
  overrides: {
    request?: Partial<NormalizedRequest>;
    context?: Partial<ResolvedContext>;
    policies?: PolicyRuleRow[];
    catalogResult?: CatalogResult;
    routingProfile?: RoutingProfileRow;
    totalCostUsd?: number;
    now?: Date;
  } = {},
) {
  const router = createRouterScenario({
    policies: overrides.policies,
    catalogResult: overrides.catalogResult,
    routingProfile: overrides.routingProfile,
    totalCostUsd: overrides.totalCostUsd,
    now: overrides.now,
  });

  return router.route({
    request: {
      ...BASE_REQUEST,
      ...overrides.request,
    },
    context: {
      ...BASE_CONTEXT,
      ...overrides.context,
      mode:
        overrides.request?.mode ?? overrides.context?.mode ?? BASE_CONTEXT.mode,
      taskType:
        overrides.request?.taskType ??
        overrides.context?.taskType ??
        BASE_CONTEXT.taskType,
    },
  });
}

test("max_quality prefers the best-quality eligible candidate even when costlier", async () => {
  const decision = await routeDecision({
    request: {
      mode: "max_quality",
    },
  });

  assertSelected(decision);
  assert.equal(decision.selected.provider, "openai");
  assert.equal(decision.selectionReasonCode, "best_score_for_mode");
  assert.equal(decision.selected.score, 70);
});

test("balanced selects the better compromise across quality, cost, and performance", async () => {
  const decision = await routeDecision();

  assertSelected(decision);
  assert.equal(decision.selected.provider, "anthropic");
  assert.equal(decision.selectionReasonCode, "best_score_for_mode");
  assert.equal(decision.selected.score, 55);
});

test("budget lets cost dominate while quality and performance remain corrective", async () => {
  const decision = await routeDecision({
    request: {
      mode: "budget",
    },
  });

  assertSelected(decision);
  assert.equal(decision.selected.provider, "anthropic");
  assert.equal(decision.selectionReasonCode, "best_score_for_mode");
  assert.equal(decision.selected.score, 75);
});

test("deny rules remove otherwise better-scoring candidates", async () => {
  const decision = await routeDecision({
    request: {
      mode: "max_quality",
    },
    policies: [
      createPolicyRule({
        id: "pol_deny_openai_model",
        name: "Deny premium OpenAI model",
        ruleType: "deny_model",
        enforcementMode: "hard_block",
        conditionsJson: {
          models: ["gpt-5.2"],
        },
      }),
    ],
  });

  assertSelected(decision);
  assert.equal(decision.selected.provider, "anthropic");
  assert.equal(
    decision.excludedCandidates?.[0]?.reasonCode,
    "policy_denied_model",
  );
});

test("restrictive allow-lists can block when no candidates remain", async () => {
  const decision = await routeDecision({
    policies: [
      createPolicyRule({
        id: "pol_allow_unknown_model",
        name: "Allow only an unknown model",
        ruleType: "allow_model",
        enforcementMode: "hard_block",
        conditionsJson: {
          models: ["does-not-exist"],
        },
      }),
    ],
  });

  assertBlocked(decision);
  assert.equal(
    decision.selectionReasonCode,
    "policy_blocked_no_eligible_candidate",
  );
});

test("budget cap blocks before ranking using only workspace monthly recorded cost", async () => {
  const decision = await routeDecision({
    policies: [
      createPolicyRule({
        id: "pol_budget_cap",
        name: "Monthly budget cap",
        ruleType: "budget_cap",
        enforcementMode: "hard_block",
        conditionsJson: {
          limitUsd: 100,
        },
      }),
    ],
    totalCostUsd: 100,
  });

  assertBlocked(decision);
  assert.equal(decision.selectionReasonCode, "policy_blocked_budget_cap");
});

test("stale benchmark snapshots emit a warning but still select a candidate", async () => {
  const decision = await routeDecision({
    catalogResult: createCatalogResult({
      snapshotSyncedAt: "2026-03-10T00:00:00.000Z",
    }),
    now: new Date("2026-03-23T12:00:00.000Z"),
  });

  assertSelected(decision);
  assert.equal(decision.warnings?.[0]?.code, "benchmark_snapshot_stale");
});

test("benchmark gaps fall back to catalog scoring without losing determinism", async () => {
  const routingProfile = createRoutingProfile({
    candidatesByMode: {
      balanced: [
        {
          provider: "anthropic",
          modelId: "claude-sonnet-4-20250514",
        },
        {
          provider: "openai",
          modelId: "gpt-5-mini",
        },
      ],
    },
  });
  const catalogResult = createCatalogResult({
    snapshotSyncedAt: null,
    rows: [
      createCatalogRow({
        provider: "openai",
        modelId: "gpt-5-mini",
        label: "OpenAI GPT-5 Mini",
        costTier: "medium",
        latencyTier: "medium",
        benchmark: null,
      }),
      createCatalogRow({
        provider: "anthropic",
        modelId: "claude-sonnet-4-20250514",
        label: "Anthropic Claude Sonnet 4",
        costTier: "medium",
        latencyTier: "medium",
        benchmark: null,
      }),
    ],
  });

  const firstDecision = await routeDecision({
    catalogResult,
    routingProfile,
  });
  const secondDecision = await routeDecision({
    catalogResult,
    routingProfile,
  });

  assertSelected(firstDecision);
  assertSelected(secondDecision);
  assert.equal(firstDecision.selectionReasonCode, "stable_order_tiebreak");
  assert.equal(firstDecision.selected.provider, "anthropic");
  assert.equal(
    firstDecision.selected.provider,
    secondDecision.selected.provider,
  );
});

test("tie cases within three points use preferred provider after lower cost remains tied", async () => {
  const snapshotSyncedAt = "2026-03-23T00:00:00.000Z";
  const catalogResult = createCatalogResult({
    snapshotSyncedAt,
    rows: [
      createCatalogRow({
        provider: "openai",
        modelId: "gpt-5-mini",
        label: "OpenAI GPT-5 Mini",
        costTier: "medium",
        benchmark: {
          sourceName: "artificial_analysis",
          syncedAt: snapshotSyncedAt,
          qualityGeneralScore: 90,
          qualityCodingScore: 90,
          priceInputPer1mTokensUsd: 10,
          priceOutputPer1mTokensUsd: 10,
          outputTokensPerSecond: 60,
          timeToFirstTokenMs: 180,
        },
      }),
      createCatalogRow({
        provider: "anthropic",
        modelId: "claude-sonnet-4-20250514",
        label: "Anthropic Claude Sonnet 4",
        costTier: "medium",
        benchmark: {
          sourceName: "artificial_analysis",
          syncedAt: snapshotSyncedAt,
          qualityGeneralScore: 90,
          qualityCodingScore: 90,
          priceInputPer1mTokensUsd: 10,
          priceOutputPer1mTokensUsd: 10,
          outputTokensPerSecond: 60,
          timeToFirstTokenMs: 180,
        },
      }),
    ],
  });
  const decision = await routeDecision({
    catalogResult,
    policies: [
      createPolicyRule({
        id: "pol_prefer_anthropic",
        name: "Prefer Anthropic",
        ruleType: "preferred_provider",
        enforcementMode: "soft_warn",
        conditionsJson: {
          provider: "anthropic",
        },
      }),
    ],
  });

  assertSelected(decision);
  assert.equal(decision.selectionReasonCode, "preferred_provider_tiebreak");
  assert.equal(decision.selected.provider, "anthropic");
});
