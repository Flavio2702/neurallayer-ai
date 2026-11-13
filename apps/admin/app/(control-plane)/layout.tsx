import type { ReactNode } from "react";

import { ControlPlaneShell } from "@/components/control-plane-shell";
import { requireAdminSession } from "@/lib/admin-access-gate";

import { logoutAdminSession } from "./actions";

export const dynamic = "force-dynamic";

interface ControlPlaneLayoutProps {
  children: ReactNode;
}

export default async function ControlPlaneLayout({
  children,
}: ControlPlaneLayoutProps) {
  await requireAdminSession();

  return (
    <ControlPlaneShell
      headerAction={
        <form action={logoutAdminSession}>
          <button
            type="submit"
            className="inline-flex items-center rounded-full border border-[hsl(var(--border))] bg-card px-4 py-2 text-sm font-semibold text-[hsl(var(--foreground))] transition-colors hover:border-[hsl(var(--foreground))]"
          >
            Logout
          </button>
        </form>
      }
    >
      {children}
    </ControlPlaneShell>
  );
}
