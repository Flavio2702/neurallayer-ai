export type ControlPlaneRouteId =
  | "overview"
  | "trial-summary"
  | "requests"
  | "providers"
  | "projects"
  | "playground"
  | "workspace-settings"
  | "audit";

export interface ControlPlaneRoute {
  id: ControlPlaneRouteId;
  href: string;
  title: string;
  description: string;
}

export const controlPlaneRoutes: ControlPlaneRoute[] = [
  {
    id: "overview",
    href: "/",
    title: "Overview",
    description:
      "Quick month-to-date posture with recent blocked and audit context. This page stays intentionally light.",
  },
  {
    id: "trial-summary",
    href: "/trial-summary",
    title: "Trial summary",
    description:
      "Tight manager-facing view of recent trial volume, spend, splits, and runtime highlights without replacing Requests.",
  },
  {
    id: "requests",
    href: "/requests",
    title: "Requests",
    description:
      "Primary operational surface for request outcomes, blocked traffic, provider errors, and concise explainability once traffic is flowing.",
  },
  {
    id: "providers",
    href: "/providers",
    title: "Providers",
    description:
      "Save credentials, run connection tests, and confirm truthful routing readiness.",
  },
  {
    id: "projects",
    href: "/projects",
    title: "Projects",
    description:
      "Create projects, open project detail, and manage basics, project-scoped keys, and the two narrow provider guardrails used in Sprint 2.",
  },
  {
    id: "playground",
    href: "/playground",
    title: "Playground",
    description:
      "Prepare one real one-shot request with an explicit project API key, then hand runtime reading back to Requests.",
  },
  {
    id: "workspace-settings",
    href: "/workspace-settings",
    title: "Workspace settings",
    description:
      "Review and update the only workspace-level guardrail exposed in Sprint 2: the monthly budget cap.",
  },
  {
    id: "audit",
    href: "/audit",
    title: "Audit",
    description:
      "Broader metadata-first audit trail for runtime outcomes, control-plane events, and persisted cost context.",
  },
];

export function getControlPlaneRoute(
  pathname: string | null | undefined,
): ControlPlaneRoute {
  const normalizedPath = pathname && pathname.length > 0 ? pathname : "/";
  const fallbackRoute = controlPlaneRoutes[0];

  if (!fallbackRoute) {
    throw new Error("Control plane routes are not configured.");
  }

  const exactMatch = controlPlaneRoutes.find(
    (route) => route.href === normalizedPath,
  );

  if (exactMatch) {
    return exactMatch;
  }

  const nestedMatch = controlPlaneRoutes.find(
    (route) =>
      route.href !== "/" && normalizedPath.startsWith(`${route.href}/`),
  );

  return nestedMatch ?? fallbackRoute;
}
