const ADMIN_LOGIN_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const ADMIN_LOGIN_RATE_LIMIT_MAX_FAILURES = 5;

interface AdminLoginFailureWindow {
  failureCount: number;
  startedAtMs: number;
}

const adminLoginFailureWindows = new Map<string, AdminLoginFailureWindow>();

function normalizeAdminLoginFailureWindow(
  key: string,
  nowMs: number,
): AdminLoginFailureWindow | null {
  const window = adminLoginFailureWindows.get(key);

  if (!window) {
    return null;
  }

  if (nowMs - window.startedAtMs >= ADMIN_LOGIN_RATE_LIMIT_WINDOW_MS) {
    adminLoginFailureWindows.delete(key);
    return null;
  }

  return window;
}

export function parseClientIpAddress(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const [firstValue] = value.split(",");
  const clientIp = firstValue?.trim();

  return clientIp && clientIp.length > 0 ? clientIp : null;
}

export function isAdminLoginRateLimited(key: string, nowMs = Date.now()) {
  const window = normalizeAdminLoginFailureWindow(key, nowMs);

  return (
    window !== null &&
    window.failureCount >= ADMIN_LOGIN_RATE_LIMIT_MAX_FAILURES
  );
}

export function recordAdminLoginFailure(key: string, nowMs = Date.now()) {
  const currentWindow = normalizeAdminLoginFailureWindow(key, nowMs);
  const nextWindow = currentWindow
    ? {
        failureCount: currentWindow.failureCount + 1,
        startedAtMs: currentWindow.startedAtMs,
      }
    : {
        failureCount: 1,
        startedAtMs: nowMs,
      };

  adminLoginFailureWindows.set(key, nextWindow);

  return nextWindow;
}

export function resetAdminLoginRateLimit(key: string) {
  adminLoginFailureWindows.delete(key);
}
