import type { Mode, RequestSource, TaskType } from "../enums";

import type { JsonObject, Message } from "./common";

export interface NormalizedRequest {
  stream: false;
  messages: Message[];
  mode: Mode;
  source: RequestSource;
  requestId?: string;
  projectId?: string;
  taskType?: TaskType;
  metadata?: JsonObject;
}

export interface ResolvedContext {
  workspaceId: string;
  projectId: string;
  mode: Mode;
  source: RequestSource;
  requestId: string;
  apiKeyId: string;
  taskType?: TaskType;
}
