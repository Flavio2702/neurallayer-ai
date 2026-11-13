const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

const compactNumberFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});

export function formatCurrencyUsd(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "Unknown";
  }

  return currencyFormatter.format(value);
}

export function formatCompactNumber(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "0";
  }

  return compactNumberFormatter.format(value);
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "Not yet";
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.valueOf())) {
    return "Not yet";
  }

  return dateTimeFormatter.format(parsed);
}

export function formatPercent(numerator: number, denominator: number) {
  if (!denominator) {
    return "0%";
  }

  return `${Math.round((numerator / denominator) * 100)}%`;
}
