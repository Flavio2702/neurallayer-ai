"use server";

import { redirect } from "next/navigation";

import {
  clearAdminSession,
  requireAdminSession,
} from "@/lib/admin-access-gate";

export async function logoutAdminSession() {
  await requireAdminSession();
  await clearAdminSession();

  redirect("/login?notice=logged-out");
}
