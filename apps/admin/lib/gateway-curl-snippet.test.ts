import assert from "node:assert/strict";
import test from "node:test";

import {
  buildGatewayChatCompletionsCurlSnippet,
  PROJECT_GATEWAY_API_KEY_PLACEHOLDER,
  resolveGatewayCurlApiKey,
} from "./gateway-curl-snippet";

test("buildGatewayChatCompletionsCurlSnippet keeps project_id explicit and falls back to the raw-key placeholder", () => {
  const snippet = buildGatewayChatCompletionsCurlSnippet({
    apiKey: "",
    gatewayUrl: "http://127.0.0.1:4900",
    projectId: "proj_smoke",
  });

  assert.ok(snippet.includes("http://127.0.0.1:4900/v1/chat/completions"));
  assert.ok(
    snippet.includes(
      `Authorization: Bearer ${PROJECT_GATEWAY_API_KEY_PLACEHOLDER}`,
    ),
  );
  assert.ok(snippet.includes('"project_id": "proj_smoke"'));
});

test("buildGatewayChatCompletionsCurlSnippet keeps a provided raw key and escapes single quotes in the payload", () => {
  const snippet = buildGatewayChatCompletionsCurlSnippet({
    apiKey: "nl_raw_smoke_key",
    gatewayUrl: "http://127.0.0.1:4900",
    projectId: "proj_smoke",
    messages: [
      {
        role: "user",
        content: "Explain Bob's latest request.",
      },
    ],
  });

  assert.ok(snippet.includes("Authorization: Bearer nl_raw_smoke_key"));
  assert.ok(snippet.includes(`Bob'"'"'s latest request.`));
  assert.equal(
    resolveGatewayCurlApiKey("  "),
    PROJECT_GATEWAY_API_KEY_PLACEHOLDER,
  );
  assert.equal(
    resolveGatewayCurlApiKey(" nl_raw_smoke_key "),
    "nl_raw_smoke_key",
  );
});
