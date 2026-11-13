"use server";

import { redirect } from "next/navigation";

import {
  isValidAdminAccessPassword,
  normalizeAdminAccessPassword,
  writeAdminSession,
} from "@/lib/admin-access-gate";
import {
  isAdminLoginRateLimited,
  recordAdminLoginFailure,
  resetAdminLoginRateLimit,
  resolveAdminLoginRateLimitKey,
} from "@/lib/admin-login-rate-limit";

export async function submitAdminLogin(formData: FormData) {
  const rateLimitKey = await resolveAdminLoginRateLimitKey();

  if (isAdminLoginRateLimited(rateLimitKey)) {
    redirect("/login?error=rate-limited");
  }

  const password = normalizeAdminAccessPassword(formData.get("password"));

  if (!password) {
    redirect("/login?error=missing-password");
  }

  if (!isValidAdminAccessPassword(password)) {
    const failureWindow = recordAdminLoginFailure(rateLimitKey);

    if (failureWindow.failureCount >= 5) {
      redirect("/login?error=rate-limited");
    }

    redirect("/login?error=invalid-password");
  }

  try {
    resetAdminLoginRateLimit(rateLimitKey);
    await writeAdminSession();
  } catch {
    redirect("/login?error=session-unavailable");
  }

  redirect("/");
}
