import type { IncomingHttpHeaders } from "node:http";
import type {
  JsonObject,
  JsonValue,
  Message,
  Mode,
  ProviderName,
  TaskType,
} from "@neuralayer/core";
import {
  MESSAGE_ROLE_VALUES,
  MODE_VALUES,
  PROVIDER_NAME_VALUES,
  TASK_TYPE_VALUES,
} from "@neuralayer/core";
import { z } from "zod";

import { createInvalidRequestError } from "./api-error";
import { getOptionalHeaderValue } from "./headers";

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

const jsonObjectSchema: z.ZodType<JsonObject> = z.record(
  z.string(),
  jsonValueSchema,
);

const messageSchema: z.ZodType<Message> = z.object({
  role: z.enum(MESSAGE_ROLE_VALUES),
  content: z.string(),
});

const chatCompletionBodySchema = z
  .object({
    messages: z.array(messageSchema).min(1),
    mode: z.enum(MODE_VALUES).optional(),
    task_type: z.enum(TASK_TYPE_VALUES).optional(),
    project_id: z.string().min(1).optional(),
    stream: z.boolean().optional(),
    metadata: jsonObjectSchema.optional(),
  })
  .strict();

const modelsQuerySchema = z
  .object({
    provider: z.enum(PROVIDER_NAME_VALUES).optional(),
    mode: z.enum(MODE_VALUES).optional(),
    task_type: z.enum(TASK_TYPE_VALUES).optional(),
  })
  .strict();

export type ChatCompletionBody = z.infer<typeof chatCompletionBodySchema>;
export type ModelsQuery = z.infer<typeof modelsQuerySchema>;

export interface EffectiveChatCompletionRequest {
  messages: Message[];
  mode: Mode;
  taskType: TaskType;
  projectId?: string;
  stream: boolean;
  metadata?: JsonObject;
}

function getIssuePath(error: z.ZodError) {
  return error.issues[0]?.path[0];
}

function mapChatCompletionValidationError(error: z.ZodError) {
  const issuePath = getIssuePath(error);

  if (issuePath === "messages") {
    return createInvalidRequestError(
      "missing_messages",
      "The request body must include at least one message.",
    );
  }

  if (issuePath === "mode") {
    return createInvalidRequestError(
      "invalid_mode",
      "The provided mode is invalid.",
    );
  }

  if (issuePath === "task_type") {
    return createInvalidRequestError(
      "invalid_task_type",
      "The provided task type is invalid.",
    );
  }

  if (issuePath === "project_id") {
    return createInvalidRequestError(
      "missing_project_id",
      "The provided project ID is invalid.",
    );
  }

  return createInvalidRequestError(
    "invalid_request",
    "Request validation failed.",
  );
}

function mapModelsQueryValidationError(error: z.ZodError) {
  const issuePath = getIssuePath(error);

  if (issuePath === "provider") {
    return createInvalidRequestError(
      "invalid_provider",
      "The provided provider is invalid.",
    );
  }

  if (issuePath === "mode") {
    return createInvalidRequestError(
      "invalid_mode",
      "The provided mode is invalid.",
    );
  }

  if (issuePath === "task_type") {
    return createInvalidRequestError(
      "invalid_task_type",
      "The provided task type is invalid.",
    );
  }

  return createInvalidRequestError(
    "invalid_request",
    "Request validation failed.",
  );
}

function parseModeHeader(value: string | undefined): Mode | undefined {
  if (typeof value === "undefined") {
    return undefined;
  }

  const result = z.enum(MODE_VALUES).safeParse(value);

  if (!result.success) {
    throw createInvalidRequestError(
      "invalid_mode",
      "The provided mode is invalid.",
    );
  }

  return result.data;
}

function parseTaskTypeHeader(value: string | undefined): TaskType | undefined {
  if (typeof value === "undefined") {
    return undefined;
  }

  const result = z.enum(TASK_TYPE_VALUES).safeParse(value);

  if (!result.success) {
    throw createInvalidRequestError(
      "invalid_task_type",
      "The provided task type is invalid.",
    );
  }

  return result.data;
}

function parseProjectIdHeader(value: string | undefined) {
  if (typeof value === "undefined") {
    return undefined;
  }

  const result = z.string().min(1).safeParse(value);

  if (!result.success) {
    throw createInvalidRequestError(
      "missing_project_id",
      "The provided project ID is invalid.",
    );
  }

  return result.data;
}

export function parseChatCompletionBody(body: unknown): ChatCompletionBody {
  const result = chatCompletionBodySchema.safeParse(body);

  if (!result.success) {
    throw mapChatCompletionValidationError(result.error);
  }

  return result.data;
}

export function parseModelsQuery(query: unknown): ModelsQuery {
  const result = modelsQuerySchema.safeParse(query ?? {});

  if (!result.success) {
    throw mapModelsQueryValidationError(result.error);
  }

  return result.data;
}

export function resolveEffectiveChatCompletionRequest(
  body: ChatCompletionBody,
  headers: IncomingHttpHeaders,
): EffectiveChatCompletionRequest {
  const projectId =
    body.project_id ??
    parseProjectIdHeader(
      getOptionalHeaderValue(headers["x-neuralayer-project-id"]),
    );
  const mode =
    body.mode ??
    parseModeHeader(getOptionalHeaderValue(headers["x-neuralayer-mode"])) ??
    "balanced";
  const taskType =
    body.task_type ??
    parseTaskTypeHeader(
      getOptionalHeaderValue(headers["x-neuralayer-task-type"]),
    ) ??
    "general";

  return {
    messages: body.messages,
    mode,
    taskType,
    projectId,
    stream: body.stream ?? false,
    metadata: body.metadata,
  };
}

export type ModelsQueryProvider = ProviderName | undefined;
