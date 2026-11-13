import assert from "node:assert/strict";
import test from "node:test";

import { buildRequestsCsvFilename, serializeRequestsCsv } from "./requests-csv";

test("serializeRequestsCsv keeps stable headers, escapes unsafe cells, and builds deterministic filenames", () => {
  const csv = serializeRequestsCsv([
    {
      timestamp: "2026-03-31T10:00:00.000Z",
      project: "Pilot, Alpha",
      mode: "Balanced",
      provider: 'OpenAI "Primary"',
      model: "gpt-5-mini",
      status: "Succeeded",
      latency: "321 ms",
      usage: "165 total tokens",
      cost: "$0.42",
      selectionReason: 'Manager said "share this"\nwith the pilot.',
      issueSummary: "Line 1\r\nLine 2",
    },
  ]);

  assert.equal(
    csv,
    'Timestamp,Project,Mode,Provider,Model,Status,Latency,Usage,Cost,Selection reason,Issue summary\r\n2026-03-31T10:00:00.000Z,"Pilot, Alpha",Balanced,"OpenAI ""Primary""",gpt-5-mini,Succeeded,321 ms,165 total tokens,$0.42,"Manager said ""share this""\nwith the pilot.","Line 1\r\nLine 2"',
  );
  assert.equal(
    buildRequestsCsvFilename({
      workspaceSlug: "pilot-workspace",
      range: "7d",
      exportedAt: new Date("2026-03-31T15:30:00.000Z"),
    }),
    "requests-pilot-workspace-7d-2026-03-31.csv",
  );
});
