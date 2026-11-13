import type { PolicyDecisionType, PolicyEnforcementMode } from "../enums";

import type { JsonObject } from "./common";

export interface PolicyDecision {
  type: PolicyDecisionType;
  enforcementMode: PolicyEnforcementMode;
  reasonCode: string;
  message: string;
  metadata?: JsonObject;
}
