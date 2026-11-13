import assert from "node:assert/strict";
import test from "node:test";

import {
  isValidAdminAccessPassword,
  normalizeAdminAccessPassword,
} from "./admin-access-gate-core";

const ORIGINAL_ADMIN_ACCESS_PASSWORD = process.env.ADMIN_ACCESS_PASSWORD;

function restoreAdminAccessPassword() {
  if (typeof ORIGINAL_ADMIN_ACCESS_PASSWORD === "string") {
    process.env.ADMIN_ACCESS_PASSWORD = ORIGINAL_ADMIN_ACCESS_PASSWORD;
    return;
  }

  delete process.env.ADMIN_ACCESS_PASSWORD;
}

test("normalizeAdminAccessPassword trims string values and rejects missing form entries", () => {
  assert.equal(
    normalizeAdminAccessPassword("  shared-admin-password  "),
    "shared-admin-password",
  );
  assert.equal(normalizeAdminAccessPassword(null), "");
});

test("isValidAdminAccessPassword accepts only the current shared password", () => {
  process.env.ADMIN_ACCESS_PASSWORD = "  shared-admin-password  ";

  try {
    assert.equal(
      isValidAdminAccessPassword(
        normalizeAdminAccessPassword("  shared-admin-password  "),
      ),
      true,
    );
    assert.equal(isValidAdminAccessPassword("shared-admin-passwordx"), false);
    assert.equal(isValidAdminAccessPassword("wrong-password"), false);
    assert.equal(isValidAdminAccessPassword(""), false);
  } finally {
    restoreAdminAccessPassword();
  }
});
