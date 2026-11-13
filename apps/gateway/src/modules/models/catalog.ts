import type {
  CapabilityClass,
  CostTier,
  LatencyTier,
  Mode,
  ProviderName,
  TaskType,
} from "@neuralayer/core";

import {
  listInitialModelCatalogEntries,
  listModelCatalog,
} from "@neuralayer/db";

import { tryWithDatabase } from "../../lib/database";

export interface ListVisibleModelsInput {
  provider?: ProviderName;
  mode?: Mode;
  taskType?: TaskType;
}

export interface VisibleGatewayModel {
  id: string;
  provider: ProviderName;
  model_id: string;
  label: string;
  capability_class: CapabilityClass[];
  cost_tier: CostTier;
  latency_tier: LatencyTier;
  supports_chat: boolean;
  supports_streaming: boolean;
  is_active: boolean;
}

function mapCatalogEntryToVisibleModel(entry: {
  id: string;
  provider: ProviderName;
  modelId: string;
  label: string;
  capabilityClasses: CapabilityClass[];
  costTier: CostTier;
  latencyTier: LatencyTier;
  supportsChat: boolean;
  supportsStreaming: boolean;
  isActive: boolean;
}) {
  return {
    id: entry.id,
    provider: entry.provider,
    model_id: entry.modelId,
    label: entry.label,
    capability_class: entry.capabilityClasses,
    cost_tier: entry.costTier,
    latency_tier: entry.latencyTier,
    supports_chat: entry.supportsChat,
    supports_streaming: entry.supportsStreaming,
    is_active: entry.isActive,
  } satisfies VisibleGatewayModel;
}

export async function listVisibleModels(input: ListVisibleModelsInput = {}) {
  void input.mode;
  void input.taskType;

  const databaseResult = await tryWithDatabase((database) =>
    listModelCatalog({ provider: input.provider }, database),
  );

  if (
    databaseResult.available &&
    Array.isArray(databaseResult.value) &&
    databaseResult.value.length > 0
  ) {
    return databaseResult.value.map(mapCatalogEntryToVisibleModel);
  }

  return listInitialModelCatalogEntries()
    .filter((entry) =>
      input.provider ? entry.provider === input.provider : true,
    )
    .map(mapCatalogEntryToVisibleModel);
}
