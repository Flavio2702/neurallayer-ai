import { randomUUID } from "node:crypto";

import type { Database } from "./client";
import { withDatabase } from "./connection-helpers";
import { auditEvents } from "./schema";

export const MANUAL_REQUEST_FEEDBACK_EVENT_TYPE = "request.feedback_recorded";
const MANUAL_REQUEST_FEEDBACK_SOURCE = "admin_surface_manual";
export const MAX_MANUAL_REQUEST_FEEDBACK_NOTE_LENGTH = 280;

export const MANUAL_REQUEST_FEEDBACK_VALUES = [
  "useful",
  "needs_follow_up",
  "not_useful",
] as const;

export type ManualRequestFeedbackValue =
  (typeof MANUAL_REQUEST_FEEDBACK_VALUES)[number];

export interface ManualRequestFeedback {
  auditEventId: string;
  workspaceId: string;
  projectId: string;
  requestId: string;
  value: ManualRequestFeedbackValue;
  note: string | null;
  recordedAt: string;
}

export type ManualRequestFeedbackErrorCode =
  | "request_not_found"
  | "invalid_feedback_value"
  | "note_too_long";

export class ManualRequestFeedbackError extends Error {
  readonly code: ManualRequestFeedbackErrorCode;

  constructor(code: ManualRequestFeedbackErrorCode, message: string) {
    super(message);
    this.name = "ManualRequestFeedbackError";
    this.code = code;
  }
}

export interface UpsertManualRequestFeedbackInput {
  workspaceId: string;
  requestId: string;
  value: ManualRequestFeedbackValue;
  note?: string | null;
  recordedAt?: Date | string;
}

export interface GetLatestManualRequestFeedbackInput {
  workspaceId: string;
  requestId: string;
}

interface ManualRequestFeedbackAuditRow {
  id: string;
  workspaceId: string;
  projectId: string | null;
  entityId: string;
  eventPayload: Record<string, unknown>;
  createdAt: Date;
}

function createManualRequestFeedbackError(
  code: ManualRequestFeedbackErrorCode,
) {
  switch (code) {
    case "request_not_found":
      return new ManualRequestFeedbackError(
        code,
        "The requested request does not exist in this workspace.",
      );
    case "invalid_feedback_value":
      return new ManualRequestFeedbackError(
        code,
        "Manual request feedback value is invalid.",
      );
    case "note_too_long":
      return new ManualRequestFeedbackError(
        code,
        `Manual request feedback note must be ${MAX_MANUAL_REQUEST_FEEDBACK_NOTE_LENGTH} characters or fewer.`,
      );
    default:
      return new ManualRequestFeedbackError(
        "invalid_feedback_value",
        "Manual request feedback value is invalid.",
      );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isManualRequestFeedbackValue(
  value: unknown,
): value is ManualRequestFeedbackValue {
  return MANUAL_REQUEST_FEEDBACK_VALUES.includes(
    value as ManualRequestFeedbackValue,
  );
}

function normalizeManualRequestFeedbackValue(
  value: unknown,
): ManualRequestFeedbackValue {
  if (!isManualRequestFeedbackValue(value)) {
    throw createManualRequestFeedbackError("invalid_feedback_value");
  }

  return value;
}

function normalizeManualRequestFeedbackNote(note: unknown) {
  if (typeof note !== "string") {
    return null;
  }

  const trimmedNote = note.trim();

  if (trimmedNote.length === 0) {
    return null;
  }

  if (trimmedNote.length > MAX_MANUAL_REQUEST_FEEDBACK_NOTE_LENGTH) {
    throw createManualRequestFeedbackError("note_too_long");
  }

  return trimmedNote;
}

function parseManualRequestFeedbackNote(note: unknown) {
  if (typeof note !== "string") {
    return null;
  }

  const trimmedNote = note.trim();

  if (
    trimmedNote.length === 0 ||
    trimmedNote.length > MAX_MANUAL_REQUEST_FEEDBACK_NOTE_LENGTH
  ) {
    return null;
  }

  return trimmedNote;
}

function normalizeRecordedAt(recordedAt: Date | string | undefined) {
  if (!recordedAt) {
    return new Date();
  }

  const normalizedRecordedAt =
    recordedAt instanceof Date ? recordedAt : new Date(recordedAt);

  if (Number.isNaN(normalizedRecordedAt.valueOf())) {
    throw new Error("Manual request feedback recordedAt must be a valid date.");
  }

  return normalizedRecordedAt;
}

function buildManualRequestFeedbackMessage(value: ManualRequestFeedbackValue) {
  switch (value) {
    case "useful":
      return "Recorded manual request feedback: useful.";
    case "needs_follow_up":
      return "Recorded manual request feedback: needs follow-up.";
    case "not_useful":
      return "Recorded manual request feedback: not useful.";
    default:
      return "Recorded manual request feedback.";
  }
}

function parseManualRequestFeedback(
  row: ManualRequestFeedbackAuditRow | null | undefined,
): ManualRequestFeedback | null {
  if (!row || !row.projectId || !isRecord(row.eventPayload)) {
    return null;
  }

  const feedback = isRecord(row.eventPayload.feedback)
    ? row.eventPayload.feedback
    : null;

  if (!feedback || !isManualRequestFeedbackValue(feedback.value)) {
    return null;
  }

  const note = parseManualRequestFeedbackNote(feedback.note);

  return {
    auditEventId: row.id,
    workspaceId: row.workspaceId,
    projectId: row.projectId,
    requestId: row.entityId,
    value: feedback.value,
    note,
    recordedAt: row.createdAt.toISOString(),
  };
}

async function getLatestManualRequestFeedbackRow(
  input: GetLatestManualRequestFeedbackInput,
  database: Database,
) {
  return database.query.auditEvents.findFirst({
    where: (table, { and: queryAnd, eq: queryEq }) =>
      queryAnd(
        queryEq(table.workspaceId, input.workspaceId),
        queryEq(table.entityType, "request"),
        queryEq(table.entityId, input.requestId),
        queryEq(table.eventType, MANUAL_REQUEST_FEEDBACK_EVENT_TYPE),
      ),
    orderBy: (table, { desc: queryDesc }) => [
      queryDesc(table.createdAt),
      queryDesc(table.id),
    ],
  });
}

async function requireRequestSummary(
  input: GetLatestManualRequestFeedbackInput,
  database: Database,
) {
  const request = await database.query.requests.findFirst({
    where: (table, { and: queryAnd, eq: queryEq }) =>
      queryAnd(
        queryEq(table.workspaceId, input.workspaceId),
        queryEq(table.id, input.requestId),
      ),
  });

  if (!request) {
    throw createManualRequestFeedbackError("request_not_found");
  }

  return request;
}

export async function getLatestManualRequestFeedback(
  input: GetLatestManualRequestFeedbackInput,
  database?: Database,
): Promise<ManualRequestFeedback | null> {
  return withDatabase(database, async (db) =>
    parseManualRequestFeedback(
      (await getLatestManualRequestFeedbackRow(input, db)) ?? null,
    ),
  );
}

export async function upsertManualRequestFeedback(
  input: UpsertManualRequestFeedbackInput,
  database?: Database,
): Promise<ManualRequestFeedback> {
  return withDatabase(database, async (db) => {
    const normalizedValue = normalizeManualRequestFeedbackValue(input.value);
    const normalizedNote = normalizeManualRequestFeedbackNote(input.note);
    const recordedAt = normalizeRecordedAt(input.recordedAt);
    const request = await requireRequestSummary(input, db);
    const latestFeedback = await getLatestManualRequestFeedback(input, db);

    if (
      latestFeedback &&
      latestFeedback.value === normalizedValue &&
      latestFeedback.note === normalizedNote
    ) {
      return latestFeedback;
    }

    const [auditEvent] = await db
      .insert(auditEvents)
      .values({
        id: randomUUID(),
        workspaceId: input.workspaceId,
        projectId: request.projectId,
        actorType: "system",
        eventType: MANUAL_REQUEST_FEEDBACK_EVENT_TYPE,
        entityType: "request",
        entityId: input.requestId,
        eventPayload: {
          message: buildManualRequestFeedbackMessage(normalizedValue),
          feedback: {
            value: normalizedValue,
            note: normalizedNote,
          },
          metadata: {
            source: MANUAL_REQUEST_FEEDBACK_SOURCE,
          },
        },
        createdAt: recordedAt,
      })
      .returning({
        id: auditEvents.id,
        workspaceId: auditEvents.workspaceId,
        projectId: auditEvents.projectId,
        entityId: auditEvents.entityId,
        eventPayload: auditEvents.eventPayload,
        createdAt: auditEvents.createdAt,
      });

    const parsedFeedback = parseManualRequestFeedback(auditEvent ?? null);

    if (!parsedFeedback) {
      throw new Error("Failed to persist manual request feedback.");
    }

    return parsedFeedback;
  });
}
