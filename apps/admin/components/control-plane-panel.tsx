import type { ReactNode } from "react";

interface ControlPlanePanelProps {
  title: string;
  description: string;
  children?: ReactNode;
  className?: string;
}

export function ControlPlanePanel({
  title,
  description,
  children,
  className,
}: ControlPlanePanelProps) {
  return (
    <section
      className={`rounded-3xl border border-[hsl(var(--border))] bg-[hsl(var(--card-muted))] p-5 sm:p-6 ${
        className ?? ""
      }`}
    >
      <div className="space-y-2">
        <h2 className="text-lg font-semibold tracking-tight text-[hsl(var(--foreground))]">
          {title}
        </h2>
        <p className="max-w-2xl text-sm leading-6 text-[hsl(var(--muted))]">
          {description}
        </p>
      </div>
      {children ? <div className="mt-5">{children}</div> : null}
    </section>
  );
}
