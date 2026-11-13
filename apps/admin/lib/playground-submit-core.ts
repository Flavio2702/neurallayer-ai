import {
  type GatewayErrorResponse,
  type GatewaySuccessResponse,
  type Message,
  MODE_VALUES,
  type Mode,
} from "@neuralayer/core";

import type {
  PlaygroundFormState,
  PlaygroundGatewayStage,
  PlaygroundSubmittedRequestSummary,
} from "./playground-form-state";

interface GatewayMeResponse {
  workspace: {
    id: string;
    name: string;
  };
  project: {
    id: string;
    name: string;
  } | null;
}

export interface PlaygroundProjectForSubmit {
  id: string;
  name: string;
  status: "active" | "inactive";
}

export interface PlaygroundValidationInput {
  workspaceId: string;
  defaultMode: Mode;
  projects: PlaygroundProjectForSubmit[];
  projectId: string;
  modeValue: string;
  systemPrompt: string;
  userPrompt: string;
  rawProjectApiKey: string;
}

export interface ValidatedPlaygroundSubmission {
  project: PlaygroundProjectForSubmit;
  mode: Mode;
  rawProjectApiKey: string;
  messages: Message[];
  submittedRequest: PlaygroundSubmittedRequestSummary;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isMode(value: string): value is Mode {
  return MODE_VALUES.includes(value as Mode);
}

export function isGatewayErrorResponse(
  value: unknown,
): value is GatewayErrorResponse {
  if (!isRecord(value) || !isRecord(value.error)) {
    return false;
  }

  return (
    typeof value.error.type === "string" &&
    typeof value.error.code === "string" &&
    typeof value.error.message === "string"
  );
}

export function isGatewaySuccessResponse(
  value: unknown,
): value is GatewaySuccessResponse {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.object === "string" &&
    typeof value.model === "string" &&
    typeof value.provider === "string" &&
    typeof value.mode === "string" &&
    typeof value.task_type === "string" &&
    Array.isArray(value.choices) &&
    isRecord(value.meta)
  );
}

export function isGatewayMeResponse(
  value: unknown,
): value is GatewayMeResponse {
  return (
    isRecord(value) &&
    isRecord(value.workspace) &&
    typeof value.workspace.id === "string" &&
    typeof value.workspace.name === "string" &&
    (value.project === null ||
      (isRecord(value.project) &&
        typeof value.project.id === "string" &&
        typeof value.project.name === "string"))
  );
}

export function createValidationErrorState(
  message: string,
  submittedRequest: PlaygroundSubmittedRequestSummary | null = null,
): PlaygroundFormState {
  return {
    status: "validation_error",
    message,
    submittedRequest,
    gatewayStage: null,
    gatewayResponse: null,
    gatewayError: null,
  };
}

export function createGatewayErrorState(input: {
  stage: PlaygroundGatewayStage;
  message: string;
  gatewayError: GatewayErrorResponse;
  submittedRequest: PlaygroundSubmittedRequestSummary;
}): PlaygroundFormState {
  return {
    status: "gateway_error",
    message: input.message,
    submittedRequest: input.submittedRequest,
    gatewayStage: input.stage,
    gatewayResponse: null,
    gatewayError: input.gatewayError,
  };
}

export function createTransportErrorState(input: {
  stage: PlaygroundGatewayStage;
  message: string;
  submittedRequest: PlaygroundSubmittedRequestSummary | null;
}): PlaygroundFormState {
  return {
    status: "transport_error",
    message: input.message,
    submittedRequest: input.submittedRequest,
    gatewayStage: input.stage,
    gatewayResponse: null,
    gatewayError: null,
  };
}

export function createGatewayHeaders(
  apiKey: string,
  withJsonContentType = false,
) {
  return {
    Accept: "application/json",
    Authorization: `Bearer ${apiKey}`,
    ...(withJsonContentType
      ? {
          "Content-Type": "application/json",
        }
      : {}),
  };
}

export function getGatewayErrorMessage(input: {
  stage: PlaygroundGatewayStage;
  error: GatewayErrorResponse;
}) {
  if (input.stage === "me") {
    switch (input.error.error.code) {
      case "invalid_api_key":
      case "revoked_api_key":
      case "expired_api_key":
        return "The pasted raw key is not currently usable. Paste the raw project key shown once in the matching project detail.";
      default:
        return `Gateway key validation failed: ${input.error.error.message}`;
    }
  }

  return `Gateway request failed: ${input.error.error.message}`;
}

export function buildPlaygroundMessages(input: {
  systemPrompt: string;
  userPrompt: string;
}): Message[] {
  const systemPrompt = input.systemPrompt.trim();
  const userPrompt = input.userPrompt.trim();

  return [
    ...(systemPrompt.length > 0
      ? [
          {
            role: "system" as const,
            content: systemPrompt,
          },
        ]
      : []),
    {
      role: "user",
      content: userPrompt,
    },
  ];
}

export function validatePlaygroundSubmission(input: PlaygroundValidationInput):
  | {
      ok: true;
      value: ValidatedPlaygroundSubmission;
    }
  | {
      ok: false;
      state: PlaygroundFormState;
    } {
  const project = input.projects.find((entry) => entry.id === input.projectId);

  if (!project) {
    return {
      ok: false,
      state: createValidationErrorState(
        "Select a real active project from this admin workspace before sending a playground request.",
      ),
    };
  }

  if (project.status !== "active") {
    return {
      ok: false,
      state: createValidationErrorState(
        "Activate this project in Projects before using Playground.",
        {
          projectId: project.id,
          projectName: project.name,
          mode: input.defaultMode,
          messageCount: 0,
        },
      ),
    };
  }

  if (!isMode(input.modeValue)) {
    return {
      ok: false,
      state: createValidationErrorState(
        "Select one of the supported modes before sending a playground request.",
        {
          projectId: project.id,
          projectName: project.name,
          mode: input.defaultMode,
          messageCount: 0,
        },
      ),
    };
  }

  const systemPrompt = input.systemPrompt.trim();
  const userPrompt = input.userPrompt.trim();
  const rawProjectApiKey = input.rawProjectApiKey.trim();

  if (userPrompt.length === 0) {
    return {
      ok: false,
      state: createValidationErrorState(
        "Enter a user prompt before sending a playground request.",
        {
          projectId: project.id,
          projectName: project.name,
          mode: input.modeValue,
          messageCount: systemPrompt.length > 0 ? 1 : 0,
        },
      ),
    };
  }

  if (rawProjectApiKey.length === 0) {
    return {
      ok: false,
      state: createValidationErrorState(
        "Paste the raw project API key for the selected project before sending a playground request.",
        {
          projectId: project.id,
          projectName: project.name,
          mode: input.modeValue,
          messageCount: systemPrompt.length > 0 ? 2 : 1,
        },
      ),
    };
  }

  const messages = buildPlaygroundMessages({
    systemPrompt,
    userPrompt,
  });
  const submittedRequest: PlaygroundSubmittedRequestSummary = {
    projectId: project.id,
    projectName: project.name,
    mode: input.modeValue,
    messageCount: messages.length,
  };

  return {
    ok: true,
    value: {
      project,
      mode: input.modeValue,
      rawProjectApiKey,
      messages,
      submittedRequest,
    },
  };
}

export function resolvePlaygroundMePayload(input: {
  payload: unknown;
  workspaceId: string;
  projectId: string;
  projectName: string;
  submittedRequest: PlaygroundSubmittedRequestSummary;
}):
  | {
      ok: true;
      value: GatewayMeResponse;
    }
  | {
      ok: false;
      state: PlaygroundFormState;
    } {
  if (!isGatewayMeResponse(input.payload)) {
    return {
      ok: false,
      state: createTransportErrorState({
        stage: "me",
        message:
          "Gateway key validation returned an unexpected payload for /v1/me.",
        submittedRequest: input.submittedRequest,
      }),
    };
  }

  if (input.payload.workspace.id !== input.workspaceId) {
    return {
      ok: false,
      state: createValidationErrorState(
        "The pasted raw key belongs to a different workspace and cannot be used from this admin session.",
        input.submittedRequest,
      ),
    };
  }

  if (!input.payload.project) {
    return {
      ok: false,
      state: createValidationErrorState(
        "Playground currently accepts only project-scoped keys. Generate or paste the raw key from the selected project's detail page.",
        input.submittedRequest,
      ),
    };
  }

  if (input.payload.project.id !== input.projectId) {
    return {
      ok: false,
      state: createValidationErrorState(
        `This raw key belongs to ${input.payload.project.name}. Switch the project select or paste the matching raw key for ${input.projectName}.`,
        input.submittedRequest,
      ),
    };
  }

  return {
    ok: true,
    value: input.payload,
  };
}

export function resolvePlaygroundChatPayload(input: {
  payload: unknown;
  submittedRequest: PlaygroundSubmittedRequestSummary;
}): PlaygroundFormState {
  if (isGatewayErrorResponse(input.payload)) {
    return createGatewayErrorState({
      stage: "chat_completions",
      message: getGatewayErrorMessage({
        stage: "chat_completions",
        error: input.payload,
      }),
      gatewayError: input.payload,
      submittedRequest: input.submittedRequest,
    });
  }

  if (!isGatewaySuccessResponse(input.payload)) {
    return createTransportErrorState({
      stage: "chat_completions",
      message:
        "Gateway request submission succeeded but returned an unexpected payload shape.",
      submittedRequest: input.submittedRequest,
    });
  }

  return {
    status: "gateway_success",
    message:
      "Gateway returned a one-shot response. Playground shows the immediate outcome here, while Requests stays the persisted runtime view.",
    submittedRequest: input.submittedRequest,
    gatewayStage: "chat_completions",
    gatewayResponse: input.payload,
    gatewayError: null,
  };
}
