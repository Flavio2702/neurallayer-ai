import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createProviderCredentialsCrypto,
  decryptProviderCredentials,
  encryptProviderCredentials,
  loadProviderCredentialsCrypto,
  type ProviderCredentialsEnvelopeV1,
  parseProviderCredentialsEnvelope,
} from "./provider-credentials-crypto";

const TEST_SECRET = "provider-credentials-secret-123";

test("provider credentials crypto roundtrips payloads without exposing the raw api key in the serialized envelope", () => {
  const payload = {
    apiKey: "sk-live-demo-1234",
    organizationId: "org_demo_123",
  };

  const serializedEnvelope = encryptProviderCredentials(payload, {
    PROVIDER_CREDENTIALS_SECRET: TEST_SECRET,
  });
  const envelope = JSON.parse(
    serializedEnvelope,
  ) as ProviderCredentialsEnvelopeV1;
  const decryptedPayload = decryptProviderCredentials(serializedEnvelope, {
    PROVIDER_CREDENTIALS_SECRET: TEST_SECRET,
  });

  assert.equal(serializedEnvelope.includes(payload.apiKey), false);
  assert.equal(serializedEnvelope.includes(payload.organizationId), false);
  assert.equal(envelope.version, 1);
  assert.equal(envelope.algorithm, "aes-256-gcm");
  assert.equal(envelope.kdf, "scrypt");
  assert.deepEqual(
    parseProviderCredentialsEnvelope(serializedEnvelope),
    envelope,
  );
  assert.deepEqual(decryptedPayload, payload);
});

test("loadProviderCredentialsCrypto creates a reusable encrypt/decrypt helper from env", () => {
  const crypto = loadProviderCredentialsCrypto({
    PROVIDER_CREDENTIALS_SECRET: TEST_SECRET,
  });
  const payload = {
    apiKey: "sk-live-demo-9876",
  };
  const serializedEnvelope = crypto.encryptProviderCredentials(payload);

  assert.deepEqual(
    crypto.decryptProviderCredentials(serializedEnvelope),
    payload,
  );
});

test("provider credentials crypto fails clearly when PROVIDER_CREDENTIALS_SECRET is missing", () => {
  assert.throws(
    () =>
      loadProviderCredentialsCrypto({
        PROVIDER_CREDENTIALS_SECRET: "",
      }),
    /Missing required env var PROVIDER_CREDENTIALS_SECRET/,
  );
});

test("provider credentials crypto rejects short secrets", () => {
  assert.throws(
    () =>
      createProviderCredentialsCrypto({
        secret: "too-short",
      }),
    /PROVIDER_CREDENTIALS_SECRET must be at least 16 characters\./,
  );
});

test("provider credentials crypto rejects malformed encrypted payloads", () => {
  const crypto = createProviderCredentialsCrypto({
    secret: TEST_SECRET,
  });

  assert.throws(
    () => crypto.decryptProviderCredentials("not-json"),
    /Unsupported or malformed provider credentials payload\./,
  );
});

test("provider credentials crypto rejects unsupported payload versions", () => {
  const crypto = createProviderCredentialsCrypto({
    secret: TEST_SECRET,
  });
  const serializedEnvelope = crypto.encryptProviderCredentials({
    apiKey: "sk-live-demo-4321",
  });
  const unsupportedEnvelope = JSON.stringify({
    ...(JSON.parse(serializedEnvelope) as ProviderCredentialsEnvelopeV1),
    version: 2,
  });

  assert.throws(
    () => crypto.decryptProviderCredentials(unsupportedEnvelope),
    /Unsupported provider credentials payload version\./,
  );
});

test("provider credentials crypto does not leak ciphertext when the configured secret is wrong", () => {
  const serializedEnvelope = encryptProviderCredentials(
    {
      apiKey: "sk-live-demo-1111",
    },
    {
      PROVIDER_CREDENTIALS_SECRET: TEST_SECRET,
    },
  );

  assert.throws(
    () =>
      decryptProviderCredentials(serializedEnvelope, {
        PROVIDER_CREDENTIALS_SECRET: "different-provider-secret-456",
      }),
    /Unable to decrypt provider credentials with the configured PROVIDER_CREDENTIALS_SECRET\./,
  );
});
