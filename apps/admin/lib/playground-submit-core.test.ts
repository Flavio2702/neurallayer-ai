import assert from "node:assert/strict";
import test from "node:test";

import { PROJECT_GATEWAY_API_KEY_PLACEHOLDER } from "./gateway-curl-snippet";
import {
  createGatewayHeaders,
  getGatewayErrorMessage,
  resolvePlaygroundChatPayload,
  resolvePlaygroundMePayload,
  validatePlaygroundSubmission,
} from "./playground-submit-core";

const ACTIVE_PROJECT = {
  id: "proj_active",
  name: "Smoke Project",
  status: "active" as const,
};

test("validatePlaygroundSubmission blocks missing prompts and missing raw keys with stable messages", () => {
  const missingPrompt = validatePlaygroundSubmission({
    workspaceId: "ws_demo",
    defaultMode: "balanced",
    projects: [ACTIVE_PROJECT],
    projectId: ACTIVE_PROJECT.id,
    modeValue: "balanced",
    systemPrompt: "System",
    userPrompt: "",
    rawProjectApiKey: "nl_raw_key",
  });

  assert.equal(missingPrompt.ok, false);
  assert.equal(missingPrompt.state.status, "validation_error");
  assert.equal(
    missingPrompt.state.message,
    "Enter a user prompt before sending a playground request.",
  );
  assert.deepEqual(missingPrompt.state.submittedRequest, {
    projectId: ACTIVE_PROJECT.id,
    projectName: ACTIVE_PROJECT.name,
    mode: "balanced",
    messageCount: 1,
  });

  const missingRawKey = validatePlaygroundSubmission({
    workspaceId: "ws_demo",
    defaultMode: "balanced",
    projects: [ACTIVE_PROJECT],
    projectId: ACTIVE_PROJECT.id,
    modeValue: "balanced",
    systemPrompt: "System",
    userPrompt: "Run the request.",
    rawProjectApiKey: "  ",
  });

  assert.equal(missingRawKey.ok, false);
  assert.equal(missingRawKey.state.status, "validation_error");
  assert.equal(
    missingRawKey.state.message,
    "Paste the raw project API key for the selected project before sending a playground request.",
  );
  assert.deepEqual(missingRawKey.state.submittedRequest, {
    projectId: ACTIVE_PROJECT.id,
    projectName: ACTIVE_PROJECT.name,
    mode: "balanced",
    messageCount: 2,
  });
});

test("validatePlaygroundSubmission returns normalized messages and summary for a valid one-shot request", () => {
  const result = validatePlaygroundSubmission({
    workspaceId: "ws_demo",
    defaultMode: "balanced",
    projects: [ACTIVE_PROJECT],
    projectId: ACTIVE_PROJECT.id,
    modeValue: "budget",
    systemPrompt: "  Keep it short. ",
    userPrompt: "  Explain the latest request. ",
    rawProjectApiKey: "  nl_valid_raw_key  ",
  });

  assert.equal(result.ok, true);
  assert.equal(result.value.mode, "budget");
  assert.equal(result.value.rawProjectApiKey, "nl_valid_raw_key");
  assert.deepEqual(result.value.submittedRequest, {
    projectId: ACTIVE_PROJECT.id,
    projectName: ACTIVE_PROJECT.name,
    mode: "budget",
    messageCount: 2,
  });
  assert.deepEqual(result.value.messages, [
    {
      role: "system",
      content: "Keep it short.",
    },
    {
      role: "user",
      content: "Explain the latest request.",
    },
  ]);
});

test("resolvePlaygroundMePayload classifies workspace and project mismatches after /v1/me", () => {
  const submittedRequest = {
    projectId: ACTIVE_PROJECT.id,
    projectName: ACTIVE_PROJECT.name,
    mode: "balanced" as const,
    messageCount: 1,
  };
  const wrongWorkspace = resolvePlaygroundMePayload({
    payload: {
      workspace: {
        id: "ws_other",
        name: "Other Workspace",
      },
      project: {
        id: ACTIVE_PROJECT.id,
        name: ACTIVE_PROJECT.name,
      },
    },
    workspaceId: "ws_demo",
    projectId: ACTIVE_PROJECT.id,
    projectName: ACTIVE_PROJECT.name,
    submittedRequest,
  });

  assert.equal(wrongWorkspace.ok, false);
  assert.equal(wrongWorkspace.state.status, "validation_error");
  assert.equal(
    wrongWorkspace.state.message,
    "The pasted raw key belongs to a different workspace and cannot be used from this admin session.",
  );

  const wrongProject = resolvePlaygroundMePayload({
    payload: {
      workspace: {
        id: "ws_demo",
        name: "Demo Workspace",
      },
      project: {
        id: "proj_other",
        name: "Other Project",
      },
    },
    workspaceId: "ws_demo",
    projectId: ACTIVE_PROJECT.id,
    projectName: ACTIVE_PROJECT.name,
    submittedRequest,
  });

  assert.equal(wrongProject.ok, false);
  assert.equal(wrongProject.state.status, "validation_error");
  assert.equal(
    wrongProject.state.message,
    "This raw key belongs to Other Project. Switch the project select or paste the matching raw key for Smoke Project.",
  );
});

test("resolvePlaygroundChatPayload maps structured chat success responses into the one-shot success state", () => {
  const submittedRequest = {
    projectId: ACTIVE_PROJECT.id,
    projectName: ACTIVE_PROJECT.name,
    mode: "balanced" as const,
    messageCount: 1,
  };
  const state = resolvePlaygroundChatPayload({
    payload: {
      id: "req_smoke",
      object: "chat.completion",
      created: 1_775_000_000,
      model: "gpt-5-mini",
      provider: "openai",
      mode: "balanced",
      task_type: "general",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: "Smoke response.",
          },
          finish_reason: "stop",
        },
      ],
      usage: {
        input_tokens: 12,
        output_tokens: 8,
        total_tokens: 20,
      },
      meta: {
        workspace_id: "ws_demo",
        project_id: ACTIVE_PROJECT.id,
        selection_reason: {
          code: "best_score_for_mode",
          text: "Selected the best candidate.",
        },
      },
    },
    submittedRequest,
  });

  assert.equal(state.status, "gateway_success");
  assert.equal(state.gatewayStage, "chat_completions");
  assert.equal(state.gatewayResponse.id, "req_smoke");
  assert.equal(state.gatewayResponse.provider, "openai");
});

test("createGatewayHeaders and getGatewayErrorMessage keep the real gateway path readable", () => {
  assert.deepEqual(createGatewayHeaders("nl_raw_key", true), {
    Accept: "application/json",
    Authorization: "Bearer nl_raw_key",
    "Content-Type": "application/json",
  });
  assert.equal(
    getGatewayErrorMessage({
      stage: "me",
      error: {
        error: {
          type: "auth_error",
          code: "invalid_api_key",
          message: `Paste ${PROJECT_GATEWAY_API_KEY_PLACEHOLDER} no longer works.`,
          request_id: "req_auth",
        },
      },
    }),
    "The pasted raw key is not currently usable. Paste the raw project key shown once in the matching project detail.",
  );
});
