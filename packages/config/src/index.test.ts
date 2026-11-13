import assert from "node:assert/strict";
import test from "node:test";

import {
  loadAdminAccessGateConfig,
  loadAdminConfig,
  loadAdminSessionConfig,
  loadDatabaseConfig,
  loadProviderCredentialsConfig,
  parseRuntimeEnv,
} from "./index";

const TEST_DATABASE_URL =
  "postgres://postgres:postgres@localhost:5432/neurallayer";
const TEST_GATEWAY_URL = "http://localhost:4000";

function createBaseEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    DATABASE_URL: TEST_DATABASE_URL,
    NEXT_PUBLIC_GATEWAY_URL: TEST_GATEWAY_URL,
    ...overrides,
  };
}

test("parseRuntimeEnv normalizes blank admin env vars to undefined", () => {
  const runtimeEnv = parseRuntimeEnv(
    createBaseEnv({
      ADMIN_WORKSPACE_ID: "   ",
      ADMIN_SMOKE_WORKSPACE_ID: " ",
      ADMIN_ACCESS_PASSWORD: "   ",
      ADMIN_SESSION_SECRET: "",
      PROVIDER_CREDENTIALS_SECRET: "  ",
    }),
  );

  assert.equal(runtimeEnv.ADMIN_WORKSPACE_ID, undefined);
  assert.equal(runtimeEnv.ADMIN_SMOKE_WORKSPACE_ID, undefined);
  assert.equal(runtimeEnv.ADMIN_ACCESS_PASSWORD, undefined);
  assert.equal(runtimeEnv.ADMIN_SESSION_SECRET, undefined);
  assert.equal(runtimeEnv.PROVIDER_CREDENTIALS_SECRET, undefined);
});

test("loadAdminConfig and loadDatabaseConfig stay tolerant when admin workspace targeting and security secrets are absent", () => {
  const env = createBaseEnv({
    ADMIN_WORKSPACE_ID: "",
    ADMIN_SMOKE_WORKSPACE_ID: "",
    ADMIN_ACCESS_PASSWORD: "",
    ADMIN_SESSION_SECRET: "",
    PROVIDER_CREDENTIALS_SECRET: "",
    ARTIFICIAL_ANALYSIS_API_KEY: "   ",
  });

  assert.deepEqual(loadAdminConfig(env), {
    nodeEnv: "test",
    admin: {
      port: 3000,
      workspaceId: undefined,
      smokeWorkspaceId: undefined,
    },
    public: {
      gatewayUrl: TEST_GATEWAY_URL,
    },
  });
  assert.deepEqual(loadDatabaseConfig(env), {
    nodeEnv: "test",
    database: {
      url: TEST_DATABASE_URL,
    },
    artificialAnalysis: {
      apiKey: undefined,
    },
  });
});

test("loadAdminConfig returns trimmed admin workspace targeting env vars", () => {
  const env = createBaseEnv({
    ADMIN_WORKSPACE_ID: "  ws_pilot_founder  ",
    ADMIN_SMOKE_WORKSPACE_ID: "  ws_admin_smoke_123  ",
  });

  assert.deepEqual(loadAdminConfig(env), {
    nodeEnv: "test",
    admin: {
      port: 3000,
      workspaceId: "ws_pilot_founder",
      smokeWorkspaceId: "ws_admin_smoke_123",
    },
    public: {
      gatewayUrl: TEST_GATEWAY_URL,
    },
  });
});

test("security loaders return trimmed configured secrets", () => {
  const env = createBaseEnv({
    ADMIN_ACCESS_PASSWORD: "  shared-admin-password  ",
    ADMIN_SESSION_SECRET: "  admin-session-secret-1234  ",
    PROVIDER_CREDENTIALS_SECRET: "  provider-credentials-secret-1234  ",
  });

  assert.deepEqual(loadAdminAccessGateConfig(env), {
    accessPassword: "shared-admin-password",
  });
  assert.deepEqual(loadAdminSessionConfig(env), {
    sessionSecret: "admin-session-secret-1234",
  });
  assert.deepEqual(loadProviderCredentialsConfig(env), {
    providerCredentialsSecret: "provider-credentials-secret-1234",
  });
});

test("security loaders fail with readable errors when the required secret is missing", () => {
  assert.throws(
    () =>
      loadAdminAccessGateConfig(
        createBaseEnv({
          ADMIN_ACCESS_PASSWORD: "",
        }),
      ),
    /Missing required env var ADMIN_ACCESS_PASSWORD: required for the admin access gate\./,
  );
  assert.throws(
    () =>
      loadAdminSessionConfig(
        createBaseEnv({
          ADMIN_SESSION_SECRET: "",
        }),
      ),
    /Missing required env var ADMIN_SESSION_SECRET: required for admin session signing\./,
  );
  assert.throws(
    () =>
      loadProviderCredentialsConfig(
        createBaseEnv({
          PROVIDER_CREDENTIALS_SECRET: "",
        }),
      ),
    /Missing required env var PROVIDER_CREDENTIALS_SECRET: required for provider credential encryption\/decryption\./,
  );
});
