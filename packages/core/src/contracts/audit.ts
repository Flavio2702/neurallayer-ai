import type { AuditActorType } from "../enums";

import type { JsonObject } from "./common";

export interface AuditEvent {
  workspaceId: string;
  eventType: string;
  message: string;
  createdAt: string;
  projectId?: string;
  requestId?: string;
  actorType?: AuditActorType;
  metadata?: JsonObject;
}
