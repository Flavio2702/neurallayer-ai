import { timingSafeEqual } from "node:crypto";

import { loadAdminAccessGateConfig } from "@neuralayer/config";

export function normalizeAdminAccessPassword(
  value: FormDataEntryValue | null,
): string {
  return typeof value === "string" ? value.trim() : "";
}

export function isValidAdminAccessPassword(password: string): boolean {
  if (!password) {
    return false;
  }

  const { accessPassword } = loadAdminAccessGateConfig();
  const providedPassword = Buffer.from(password, "utf8");
  const expectedPassword = Buffer.from(accessPassword, "utf8");

  if (providedPassword.length !== expectedPassword.length) {
    return false;
  }

  return timingSafeEqual(providedPassword, expectedPassword);
}
