import assert from "node:assert/strict";
import { test } from "node:test";

import {
  clearProviderAccountOperationalOutcomeMetadata,
  readProviderAccountOperationalOutcome,
} from "./provider-account-posture-service";

test("provider account posture metadata reader parses the new lastProviderOutcome shape", () => {
  const outcome = readProviderAccountOperationalOutcome(
    {
      lastProviderOutcome: {
        source: "provider_test",
        provider: "openai",
        modelId: "gpt-5-mini",
        requestStatus: "failed",
        errorType: "auth_error",
        errorCode: "provider_auth_failed",
        errorMessage: "Incorrect API key provided.",
        latencyMs: 123,
        responseId: "resp_test",
        testedAt: "2026-03-26T10:00:00.000Z",
      },
    },
    "openai",
  );

  assert.deepEqual(outcome, {
    source: "provider_test",
    provider: "openai",
    modelId: "gpt-5-mini",
    requestStatus: "failed",
    errorType: "auth_error",
    errorCode: "provider_auth_failed",
    errorMessage: "Incorrect API key provided.",
    latencyMs: 123,
    responseId: "resp_test",
    testedAt: "2026-03-26T10:00:00.000Z",
  });
});

test("provider account posture metadata reader falls back to the legacy lastRuntimeOutcome shape", () => {
  const outcome = readProviderAccountOperationalOutcome(
    {
      lastRuntimeOutcome: {
        requestStatus: "failed",
        errorType: "timeout",
        errorCode: "provider_timeout",
        testedAt: "2026-03-26T11:00:00.000Z",
      },
    },
    "anthropic",
  );

  assert.deepEqual(outcome, {
    source: "runtime",
    provider: "anthropic",
    modelId: null,
    requestStatus: "failed",
    errorType: "timeout",
    errorCode: "provider_timeout",
    errorMessage: null,
    latencyMs: null,
    responseId: null,
    testedAt: "2026-03-26T11:00:00.000Z",
  });
});

test("provider account posture metadata cleanup removes legacy and current outcome keys", () => {
  assert.deepEqual(
    clearProviderAccountOperationalOutcomeMetadata({
      credentialMask: "****1234",
      lastProviderOutcome: {
        source: "provider_test",
      },
      lastRuntimeOutcome: {
        requestStatus: "failed",
      },
    }),
    {
      credentialMask: "****1234",
    },
  );
});
