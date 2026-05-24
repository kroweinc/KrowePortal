function formatMinutes(min: number): string {
  if (min < 60) return `${min} min`;
  const hours = min / 60;
  const rounded = Math.round(hours * 2) / 2;
  return Number.isInteger(rounded) ? `${rounded}h` : `${rounded}h`;
}

export function formatEstimate(low: number | null, high: number | null): string | null {
  if (low == null || high == null) return null;
  if (low === high) return formatMinutes(low);
  if (low < 60 && high < 60) return `${low}–${high} min`;
  if (low >= 60 && high >= 60) {
    const lh = Math.round((low / 60) * 2) / 2;
    const hh = Math.round((high / 60) * 2) / 2;
    return `${lh}–${hh}h`;
  }
  return `${formatMinutes(low)} – ${formatMinutes(high)}`;
}

export function formatHours(hours: number): string {
  const rounded = Math.round(hours * 4) / 4;
  return `${rounded}h`;
}

export function formatHoursRange(
  low: number | null | undefined,
  high: number | null | undefined,
  fallback: number | null | undefined = null
): string | null {
  if (low != null && high != null) {
    const lo = Math.round(low * 4) / 4;
    const hi = Math.round(high * 4) / 4;
    if (lo === hi) return `${lo}h`;
    return `${lo}–${hi}h`;
  }
  if (fallback != null) return formatHours(fallback);
  return null;
}
