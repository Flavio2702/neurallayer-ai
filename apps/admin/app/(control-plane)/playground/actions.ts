"use server";

import { loadAdminConfig } from "@neuralayer/config";
import type { Mode } from "@neuralayer/core";
import { listProjects, resolveDefaultAdminWorkspace } from "@neuralayer/db";

import { requireAdminSession } from "@/lib/admin-access-gate";
import type { PlaygroundFormState } from "@/lib/playground-form-state";
import {
  createGatewayErrorState,
  createGatewayHeaders,
  createTransportErrorState,
  getGatewayErrorMessage,
  isGatewayErrorResponse,
  resolvePlaygroundChatPayload,
  resolvePlaygroundMePayload,
  validatePlaygroundSubmission,
} from "@/lib/playground-submit-core";

function buildPlaygroundUrl(pathname: string) {
  const {
    public: { gatewayUrl },
  } = loadAdminConfig();

  return new URL(pathname, gatewayUrl);
}

async function readJsonPayload(response: Response) {
  const rawBody = await response.text();

  if (rawBody.trim().length === 0) {
    return null;
  }

  try {
    return JSON.parse(rawBody) as unknown;
  } catch {
    return null;
  }
}

export async function submitPlaygroundRequest(
  formData: FormData,
): Promise<PlaygroundFormState> {
  await requireAdminSession();

  const workspaceContext = await resolveDefaultAdminWorkspace();

  if (!workspaceContext) {
    return {
      status: "validation_error",
      message: "No active workspace is available in the configured database.",
      submittedRequest: null,
      gatewayStage: null,
      gatewayResponse: null,
      gatewayError: null,
    };
  }

  const projectId = String(formData.get("projectId") ?? "").trim();
  const modeValue = String(formData.get("mode") ?? "").trim();
  const systemPrompt = String(formData.get("systemPrompt") ?? "").trim();
  const userPrompt = String(formData.get("userPrompt") ?? "").trim();
  const rawProjectApiKey = String(
    formData.get("rawProjectApiKey") ?? "",
  ).trim();

  const projects = await listProjects(workspaceContext.workspace.id);
  const validation = validatePlaygroundSubmission({
    workspaceId: workspaceContext.workspace.id,
    defaultMode: workspaceContext.workspace.defaultMode as Mode,
    projects: projects.map((project) => ({
      id: project.id,
      name: project.name,
      status: project.status,
    })),
    projectId,
    modeValue,
    systemPrompt,
    userPrompt,
    rawProjectApiKey,
  });

  if (!validation.ok) {
    return validation.state;
  }

  const {
    project: selectedProject,
    mode,
    rawProjectApiKey: normalizedRawProjectApiKey,
    messages,
    submittedRequest,
  } = validation.value;

  let mePayload: unknown;

  try {
    const meResponse = await fetch(buildPlaygroundUrl("/v1/me"), {
      method: "GET",
      headers: createGatewayHeaders(normalizedRawProjectApiKey),
      cache: "no-store",
    });
    mePayload = await readJsonPayload(meResponse);

    if (!meResponse.ok) {
      if (isGatewayErrorResponse(mePayload)) {
        return createGatewayErrorState({
          stage: "me",
          message: getGatewayErrorMessage({
            stage: "me",
            error: mePayload,
          }),
          gatewayError: mePayload,
          submittedRequest,
        });
      }

      return createTransportErrorState({
        stage: "me",
        message:
          "Gateway key validation failed before Playground could confirm the selected project context.",
        submittedRequest,
      });
    }
  } catch {
    return createTransportErrorState({
      stage: "me",
      message:
        "Playground could not reach the configured gateway URL while validating the pasted project key.",
      submittedRequest,
    });
  }

  const meResolution = resolvePlaygroundMePayload({
    payload: mePayload,
    workspaceId: workspaceContext.workspace.id,
    projectId: selectedProject.id,
    projectName: selectedProject.name,
    submittedRequest,
  });

  if (!meResolution.ok) {
    return meResolution.state;
  }

  try {
    const chatResponse = await fetch(
      buildPlaygroundUrl("/v1/chat/completions"),
      {
        method: "POST",
        headers: createGatewayHeaders(normalizedRawProjectApiKey, true),
        cache: "no-store",
        body: JSON.stringify({
          messages,
          mode,
          project_id: selectedProject.id,
          stream: false,
        }),
      },
    );
    const chatPayload = await readJsonPayload(chatResponse);

    if (!chatResponse.ok) {
      if (isGatewayErrorResponse(chatPayload)) {
        return createGatewayErrorState({
          stage: "chat_completions",
          message: getGatewayErrorMessage({
            stage: "chat_completions",
            error: chatPayload,
          }),
          gatewayError: chatPayload,
          submittedRequest,
        });
      }

      return createTransportErrorState({
        stage: "chat_completions",
        message:
          "Gateway request submission failed before Playground could read a structured error payload.",
        submittedRequest,
      });
    }

    return resolvePlaygroundChatPayload({
      payload: chatPayload,
      submittedRequest,
    });
  } catch {
    return createTransportErrorState({
      stage: "chat_completions",
      message:
        "Playground could not reach the configured gateway URL from the admin server action.",
      submittedRequest,
    });
  }
}
