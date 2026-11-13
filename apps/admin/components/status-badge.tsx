interface StatusBadgeProps {
  tone: "neutral" | "info" | "success" | "warning" | "danger";
  children: string;
}

const toneClasses = {
  neutral:
    "border-[hsl(var(--border))] bg-[hsl(var(--card-muted))] text-[hsl(var(--muted))]",
  info: "border-[hsl(var(--primary))] bg-[hsl(var(--primary-soft))] text-[hsl(var(--primary))]",
  success: "border-emerald-200 bg-emerald-50 text-emerald-700",
  warning: "border-amber-200 bg-amber-50 text-amber-700",
  danger: "border-rose-200 bg-rose-50 text-rose-700",
} as const;

export function StatusBadge({ tone, children }: StatusBadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] ${toneClasses[tone]}`}
    >
      {children}
    </span>
  );
}
