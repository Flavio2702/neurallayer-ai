import assert from "node:assert/strict";
import test from "node:test";

import {
  isAdminLoginRateLimited,
  recordAdminLoginFailure,
  resetAdminLoginRateLimit,
} from "./admin-login-rate-limit-core";

test("admin login rate limit blocks on the fifth failed attempt and reset clears the window", () => {
  const key = "admin-login-rate-limit-block";
  const nowMs = Date.UTC(2026, 2, 27, 10, 0, 0);

  resetAdminLoginRateLimit(key);

  try {
    for (let failureCount = 1; failureCount <= 4; failureCount += 1) {
      const failureWindow = recordAdminLoginFailure(key, nowMs + failureCount);

      assert.equal(failureWindow.failureCount, failureCount);
      assert.equal(isAdminLoginRateLimited(key, nowMs + failureCount), false);
    }

    const blockedWindow = recordAdminLoginFailure(key, nowMs + 5);

    assert.equal(blockedWindow.failureCount, 5);
    assert.equal(isAdminLoginRateLimited(key, nowMs + 5), true);

    resetAdminLoginRateLimit(key);

    assert.equal(isAdminLoginRateLimited(key, nowMs + 5), false);
  } finally {
    resetAdminLoginRateLimit(key);
  }
});

test("admin login rate limit expires after ten minutes and starts a fresh window", () => {
  const key = "admin-login-rate-limit-expiry";
  const nowMs = Date.UTC(2026, 2, 27, 11, 0, 0);
  const windowMs = 10 * 60 * 1000;
  const windowStartedAtMs = nowMs + 1;

  resetAdminLoginRateLimit(key);

  try {
    for (let failureCount = 1; failureCount <= 5; failureCount += 1) {
      recordAdminLoginFailure(key, nowMs + failureCount);
    }

    assert.equal(
      isAdminLoginRateLimited(key, windowStartedAtMs + windowMs - 1),
      true,
    );
    assert.equal(
      isAdminLoginRateLimited(key, windowStartedAtMs + windowMs),
      false,
    );

    const freshWindow = recordAdminLoginFailure(
      key,
      windowStartedAtMs + windowMs,
    );

    assert.equal(freshWindow.failureCount, 1);
    assert.equal(freshWindow.startedAtMs, windowStartedAtMs + windowMs);
    assert.equal(
      isAdminLoginRateLimited(key, windowStartedAtMs + windowMs),
      false,
    );
  } finally {
    resetAdminLoginRateLimit(key);
  }
});
