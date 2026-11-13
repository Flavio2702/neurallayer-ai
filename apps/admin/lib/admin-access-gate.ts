import "server-only";

import { loadAdminConfig, loadAdminSessionConfig } from "@neuralayer/config";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  ADMIN_SESSION_TTL_SECONDS,
  type AdminSessionClaims,
  issueAdminSessionToken,
  verifyAdminSessionToken,
} from "@/lib/admin-session-token";
import {
  isValidAdminAccessPassword,
  normalizeAdminAccessPassword,
} from "./admin-access-gate-core";

export const ADMIN_SESSION_COOKIE_NAME = "nl_admin_session";

function getAdminSessionCookieOptions() {
  const { nodeEnv } = loadAdminConfig();

  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: nodeEnv === "production",
    path: "/",
    maxAge: ADMIN_SESSION_TTL_SECONDS,
  };
}

export { isValidAdminAccessPassword, normalizeAdminAccessPassword };

export async function readAdminSession(): Promise<AdminSessionClaims | null> {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(ADMIN_SESSION_COOKIE_NAME)?.value;

  if (!sessionToken) {
    return null;
  }

  const { sessionSecret } = loadAdminSessionConfig();

  return verifyAdminSessionToken({
    token: sessionToken,
    sessionSecret,
  });
}

export async function hasValidAdminSession(): Promise<boolean> {
  return (await readAdminSession()) !== null;
}

export async function requireAdminSession(): Promise<AdminSessionClaims> {
  const session = await readAdminSession();

  if (!session) {
    redirect("/login");
  }

  return session;
}

export async function writeAdminSession(): Promise<AdminSessionClaims> {
  const { sessionSecret } = loadAdminSessionConfig();
  const { claims, token } = await issueAdminSessionToken({
    sessionSecret,
  });
  const cookieStore = await cookies();

  cookieStore.set(
    ADMIN_SESSION_COOKIE_NAME,
    token,
    getAdminSessionCookieOptions(),
  );

  return claims;
}

export async function clearAdminSession(): Promise<void> {
  const cookieStore = await cookies();

  cookieStore.set(ADMIN_SESSION_COOKIE_NAME, "", {
    ...getAdminSessionCookieOptions(),
    maxAge: 0,
  });
}
