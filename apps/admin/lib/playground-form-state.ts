import type {
  GatewayErrorResponse,
  GatewaySuccessResponse,
  Mode,
} from "@neuralayer/core";

export type PlaygroundGatewayStage = "me" | "chat_completions";

export interface PlaygroundSubmittedRequestSummary {
  projectId: string;
  projectName: string;
  mode: Mode;
  messageCount: number;
}

interface PlaygroundBaseFormState {
  message: string | null;
  submittedRequest: PlaygroundSubmittedRequestSummary | null;
}

export type PlaygroundFormState =
  | (PlaygroundBaseFormState & {
      status: "idle";
      gatewayStage: null;
      gatewayResponse: null;
      gatewayError: null;
    })
  | (PlaygroundBaseFormState & {
      status: "validation_error";
      gatewayStage: null;
      gatewayResponse: null;
      gatewayError: null;
    })
  | (PlaygroundBaseFormState & {
      status: "gateway_success";
      gatewayStage: "chat_completions";
      gatewayResponse: GatewaySuccessResponse;
      gatewayError: null;
    })
  | (PlaygroundBaseFormState & {
      status: "gateway_error";
      gatewayStage: PlaygroundGatewayStage;
      gatewayResponse: null;
      gatewayError: GatewayErrorResponse;
    })
  | (PlaygroundBaseFormState & {
      status: "transport_error";
      gatewayStage: PlaygroundGatewayStage;
      gatewayResponse: null;
      gatewayError: null;
    });

export const initialPlaygroundFormState: PlaygroundFormState = {
  status: "idle",
  message: null,
  submittedRequest: null,
  gatewayStage: null,
  gatewayResponse: null,
  gatewayError: null,
};
