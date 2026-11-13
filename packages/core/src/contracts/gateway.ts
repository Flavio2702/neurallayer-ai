import type {
  ErrorType,
  GatewayResponseObject,
  MessageRole,
  Mode,
  ProviderName,
  TaskType,
} from "../enums";

export interface GatewayAssistantMessage {
  role: Extract<MessageRole, "assistant">;
  content: string;
}

export interface GatewaySuccessChoice {
  index: number;
  message: GatewayAssistantMessage;
  finish_reason?: string;
}

export interface GatewaySuccessUsage {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
}

export interface GatewaySelectionReason {
  code: string;
  text: string;
}

export interface GatewayWarning {
  code: string;
  message: string;
}

export type GatewayCostSource = "provider_reported" | "estimated";

export interface GatewaySuccessMeta {
  workspace_id: string;
  project_id: string;
  latency_ms?: number;
  selection_reason?: GatewaySelectionReason;
  warnings?: GatewayWarning[];
  cost_usd?: number;
  cost_source?: GatewayCostSource;
}

export interface GatewaySuccessResponse {
  id: string;
  object: GatewayResponseObject;
  created: number;
  model: string;
  provider: ProviderName;
  mode: Mode;
  task_type: TaskType;
  choices: GatewaySuccessChoice[];
  usage?: GatewaySuccessUsage;
  meta: GatewaySuccessMeta;
}

export interface GatewayErrorPayload {
  type: ErrorType;
  code: string;
  message: string;
  request_id?: string;
}

export interface GatewayErrorResponse {
  error: GatewayErrorPayload;
}
