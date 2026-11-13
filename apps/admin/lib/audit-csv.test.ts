import assert from "node:assert/strict";
import test from "node:test";

import { buildAuditCsvFilename, serializeAuditCsv } from "./audit-csv";

test("serializeAuditCsv keeps stable headers, escapes unsafe cells, and builds deterministic filenames", () => {
  const csv = serializeAuditCsv([
    {
      timestamp: "2026-03-31T10:00:00.000Z",
      eventType: "request.feedback_recorded",
      entityType: "request",
      entityId: "req_trial",
      project: "Pilot, Alpha",
      actorType: "system",
      requestStatus: "",
      provider: "",
      model: "",
      error: "",
      cost: "",
      message: 'Recorded manual request feedback: "useful".\nKeep for review.',
    },
  ]);

  assert.equal(
    csv,
    'Timestamp,Event type,Entity type,Entity id,Project,Actor type,Request status,Provider,Model,Error,Cost,Message\r\n2026-03-31T10:00:00.000Z,request.feedback_recorded,request,req_trial,"Pilot, Alpha",system,,,,,,"Recorded manual request feedback: ""useful"".\nKeep for review."',
  );
  assert.equal(
    buildAuditCsvFilename({
      workspaceSlug: "pilot-workspace",
      range: "30d",
      exportedAt: new Date("2026-03-31T15:30:00.000Z"),
    }),
    "audit-pilot-workspace-30d-2026-03-31.csv",
  );
});
