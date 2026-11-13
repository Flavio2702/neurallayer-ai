import type {
  CapabilityClass,
  CostTier,
  JsonObject,
  LatencyTier,
  Mode,
  ProviderName,
} from "@neuralayer/core";

export type InitialModelCatalogStatus = "active" | "deprecated" | "disabled";

export interface InitialModelCatalogEntry {
  id: string;
  provider: ProviderName;
  modelId: string;
  label: string;
  status: InitialModelCatalogStatus;
  isActive: boolean;
  supportsChat: boolean;
  supportsStreaming: boolean;
  capabilityClasses: CapabilityClass[];
  costTier: CostTier;
  latencyTier: LatencyTier;
  metadata?: JsonObject | null;
}

export interface SupersededInitialModelCatalogEntry {
  provider: ProviderName;
  modelId: string;
  label: string;
  supersededByMappingKey: string;
}

export const INITIAL_MODEL_CATALOG: InitialModelCatalogEntry[] = [
  {
    id: "mdl_openai_gpt_5_2",
    provider: "openai",
    modelId: "gpt-5.2",
    label: "OpenAI GPT-5.2",
    status: "active",
    isActive: true,
    supportsChat: true,
    supportsStreaming: true,
    capabilityClasses: ["general", "coding", "reasoning"],
    costTier: "high",
    latencyTier: "medium",
    metadata: {
      externalBenchmarks: {
        artificialAnalysis: {
          slugs: ["gpt-5-2-non-reasoning"],
          names: ["GPT-5.2", "GPT-5.2 (Non-reasoning)"],
        },
      },
    },
  },
  {
    id: "mdl_openai_gpt_5_mini",
    provider: "openai",
    modelId: "gpt-5-mini",
    label: "OpenAI GPT-5 Mini",
    status: "active",
    isActive: true,
    supportsChat: true,
    supportsStreaming: true,
    capabilityClasses: ["general", "coding", "reasoning"],
    costTier: "medium",
    latencyTier: "medium",
    metadata: {
      externalBenchmarks: {
        artificialAnalysis: {
          slugs: ["gpt-5-mini"],
          names: ["GPT-5 mini", "GPT-5 mini (minimal)"],
        },
      },
    },
  },
  {
    id: "mdl_openai_gpt_5_nano",
    provider: "openai",
    modelId: "gpt-5-nano",
    label: "OpenAI GPT-5 Nano",
    status: "active",
    isActive: true,
    supportsChat: true,
    supportsStreaming: true,
    capabilityClasses: ["general", "coding"],
    costTier: "low",
    latencyTier: "fast",
    metadata: {
      externalBenchmarks: {
        artificialAnalysis: {
          slugs: ["gpt-5-nano"],
          names: ["GPT-5 nano", "GPT-5 nano (minimal)"],
        },
      },
    },
  },
  {
    id: "mdl_anthropic_claude_opus_4_1_20250805",
    provider: "anthropic",
    modelId: "claude-opus-4-1-20250805",
    label: "Anthropic Claude Opus 4.1",
    status: "active",
    isActive: true,
    supportsChat: true,
    supportsStreaming: true,
    capabilityClasses: ["general", "coding", "reasoning"],
    costTier: "high",
    latencyTier: "slow",
    metadata: {
      externalBenchmarks: {
        artificialAnalysis: {
          slugs: ["claude-4-1-opus-thinking"],
          names: ["Claude 4.1 Opus", "Claude 4.1 Opus (Reasoning)"],
        },
      },
    },
  },
  {
    id: "mdl_anthropic_claude_sonnet_4_20250514",
    provider: "anthropic",
    modelId: "claude-sonnet-4-20250514",
    label: "Anthropic Claude Sonnet 4",
    status: "active",
    isActive: true,
    supportsChat: true,
    supportsStreaming: true,
    capabilityClasses: ["general", "coding", "reasoning"],
    costTier: "medium",
    latencyTier: "medium",
    metadata: {
      externalBenchmarks: {
        artificialAnalysis: {
          slugs: ["claude-4-sonnet-thinking"],
          names: ["Claude 4 Sonnet", "Claude 4 Sonnet (Reasoning)"],
        },
      },
    },
  },
  {
    id: "mdl_anthropic_claude_3_5_haiku_20241022",
    provider: "anthropic",
    modelId: "claude-3-5-haiku-20241022",
    label: "Anthropic Claude Haiku 3.5",
    status: "active",
    isActive: true,
    supportsChat: true,
    supportsStreaming: true,
    capabilityClasses: ["general", "coding"],
    costTier: "low",
    latencyTier: "fast",
    metadata: {
      externalBenchmarks: {
        artificialAnalysis: {
          slugs: ["claude-3-5-haiku"],
          names: ["Claude 3.5 Haiku"],
        },
      },
    },
  },
];

export const SUPERSEDED_INITIAL_MODEL_CATALOG: SupersededInitialModelCatalogEntry[] =
  [
    {
      provider: "openai",
      modelId: "gpt-5.1",
      label: "OpenAI GPT-5.1",
      supersededByMappingKey: getModelCatalogMappingKey("openai", "gpt-5.2"),
    },
    {
      provider: "anthropic",
      modelId: "claude-opus-4-1",
      label: "Anthropic Claude Opus 4.1 (Alias)",
      supersededByMappingKey: getModelCatalogMappingKey(
        "anthropic",
        "claude-opus-4-1-20250805",
      ),
    },
    {
      provider: "anthropic",
      modelId: "claude-sonnet-4-0",
      label: "Anthropic Claude Sonnet 4 (Alias)",
      supersededByMappingKey: getModelCatalogMappingKey(
        "anthropic",
        "claude-sonnet-4-20250514",
      ),
    },
    {
      provider: "anthropic",
      modelId: "claude-3-5-haiku-latest",
      label: "Anthropic Claude Haiku 3.5 (Alias)",
      supersededByMappingKey: getModelCatalogMappingKey(
        "anthropic",
        "claude-3-5-haiku-20241022",
      ),
    },
  ];

const initialModelCatalogByMappingKey = new Map(
  INITIAL_MODEL_CATALOG.map((entry) => [
    getModelCatalogMappingKey(entry.provider, entry.modelId),
    entry,
  ]),
);

const supersededInitialModelCatalogByMappingKey = new Map(
  SUPERSEDED_INITIAL_MODEL_CATALOG.map((entry) => [
    getModelCatalogMappingKey(entry.provider, entry.modelId),
    entry,
  ]),
);

const INITIAL_MODEL_CATALOG_MODE_POOLS = {
  max_quality: [
    getModelCatalogMappingKey("openai", "gpt-5.2"),
    getModelCatalogMappingKey("anthropic", "claude-opus-4-1-20250805"),
  ],
  balanced: [
    getModelCatalogMappingKey("anthropic", "claude-sonnet-4-20250514"),
    getModelCatalogMappingKey("openai", "gpt-5-mini"),
  ],
  budget: [
    getModelCatalogMappingKey("openai", "gpt-5-nano"),
    getModelCatalogMappingKey("anthropic", "claude-3-5-haiku-20241022"),
  ],
} as const satisfies Record<Mode, readonly string[]>;

export function getModelCatalogMappingKey(
  provider: ProviderName,
  modelId: string,
) {
  return `${provider}:${modelId}`;
}

export function findInitialModelCatalogEntry(
  provider: ProviderName,
  modelId: string,
) {
  return findInitialModelCatalogEntryByMappingKey(
    getModelCatalogMappingKey(provider, modelId),
  );
}

export function findInitialModelCatalogEntryByMappingKey(mappingKey: string) {
  return initialModelCatalogByMappingKey.get(mappingKey);
}

export function listInitialModelCatalogEntries() {
  return [...INITIAL_MODEL_CATALOG];
}

export function listSupersededInitialModelCatalogEntries() {
  return [...SUPERSEDED_INITIAL_MODEL_CATALOG];
}

export function findSupersededInitialModelCatalogEntry(
  provider: ProviderName,
  modelId: string,
) {
  return supersededInitialModelCatalogByMappingKey.get(
    getModelCatalogMappingKey(provider, modelId),
  );
}

export function getInitialModelCatalogEntryOrThrow(
  provider: ProviderName,
  modelId: string,
) {
  const entry = findInitialModelCatalogEntry(provider, modelId);

  if (!entry) {
    throw new Error(
      `Initial model catalog entry not found for ${getModelCatalogMappingKey(provider, modelId)}.`,
    );
  }

  return entry;
}

export function getInitialModelCatalogEntriesForMode(mode: Mode) {
  return INITIAL_MODEL_CATALOG_MODE_POOLS[mode].map((mappingKey) => {
    const entry = findInitialModelCatalogEntryByMappingKey(mappingKey);

    if (!entry) {
      throw new Error(
        `Initial model catalog entry not found for ${mappingKey}.`,
      );
    }

    return entry;
  });
}
