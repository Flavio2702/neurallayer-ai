import assert from "node:assert/strict";
import test from "node:test";

import {
  ADMIN_SESSION_TTL_MS,
  createAdminSessionClaims,
  signAdminSessionToken,
  verifyAdminSessionToken,
} from "./admin-session-token";

const SESSION_SECRET = "0123456789abcdef-admin-session-secret";

test("signAdminSessionToken creates a token that verifies before expiry", async () => {
  const nowMs = Date.UTC(2026, 2, 24, 9, 0, 0);
  const claims = createAdminSessionClaims(nowMs);
  const token = await signAdminSessionToken({
    claims,
    sessionSecret: SESSION_SECRET,
  });
  const verifiedClaims = await verifyAdminSessionToken({
    token,
    sessionSecret: SESSION_SECRET,
    nowMs,
  });

  assert.deepEqual(verifiedClaims, claims);
});

test("verifyAdminSessionToken rejects tampered signatures", async () => {
  const token = await signAdminSessionToken({
    claims: createAdminSessionClaims(Date.UTC(2026, 2, 24, 9, 0, 0)),
    sessionSecret: SESSION_SECRET,
  });
  const [payload, signature] = token.split(".");

  assert.ok(payload);
  assert.ok(signature);

  const lastCharacter = signature.at(-1) === "a" ? "b" : "a";
  const tamperedToken = `${payload}.${signature.slice(0, -1)}${lastCharacter}`;
  const verifiedClaims = await verifyAdminSessionToken({
    token: tamperedToken,
    sessionSecret: SESSION_SECRET,
  });

  assert.equal(verifiedClaims, null);
});

test("verifyAdminSessionToken rejects expired sessions", async () => {
  const nowMs = Date.UTC(2026, 2, 24, 9, 0, 0);
  const token = await signAdminSessionToken({
    claims: createAdminSessionClaims(nowMs),
    sessionSecret: SESSION_SECRET,
  });
  const verifiedClaims = await verifyAdminSessionToken({
    token,
    sessionSecret: SESSION_SECRET,
    nowMs: nowMs + ADMIN_SESSION_TTL_MS + 1000,
  });

  assert.equal(verifiedClaims, null);
});
