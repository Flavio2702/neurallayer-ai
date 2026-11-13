import type { ProviderName } from "@neuralayer/core";

export const DEMO_WORKSPACE_ID = "ws_demo";
export const DEMO_WORKSPACE_NAME = "Demo Workspace";
export const DEMO_PROJECT_ID = "proj_demo";
export const DEMO_PROJECT_NAME = "Demo Project";
export const DEMO_API_KEY_ID = "gak_demo_workspace";
export const DEMO_API_KEY_RAW = "nl_demo_local_workspace_key";

export const DEMO_CONFIGURED_PROVIDERS = [
  "openai",
  "anthropic",
] as const satisfies readonly ProviderName[];
