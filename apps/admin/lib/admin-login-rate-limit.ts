import "server-only";

import { headers } from "next/headers";

import {
  isAdminLoginRateLimited,
  parseClientIpAddress,
  recordAdminLoginFailure,
  resetAdminLoginRateLimit,
} from "./admin-login-rate-limit-core";

export async function resolveAdminLoginRateLimitKey(): Promise<string> {
  const headerStore = await headers();
  const forwardedFor = parseClientIpAddress(headerStore.get("x-forwarded-for"));
  const realIp = parseClientIpAddress(headerStore.get("x-real-ip"));

  return forwardedFor ?? realIp ?? "unknown";
}

export {
  isAdminLoginRateLimited,
  recordAdminLoginFailure,
  resetAdminLoginRateLimit,
};
