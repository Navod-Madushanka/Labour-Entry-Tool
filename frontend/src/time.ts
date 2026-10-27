// Times are decimal hours in the workbook (7.5 = 07:30; overnight Out goes past 24).

/** Accepts "7", "730", "0730", "7:30", "7h30", "7.30" (clock) and decimal hours like "7.5";
 * null if invalid. */
export function parseClock(text: string): number | null {
  const t = text.trim();
  if (!t) return null;
  let h: number, m: number;
  let match: RegExpMatchArray | null;
  if ((match = t.match(/^(\d{1,2})[:h](\d{2})$/))) {
    h = +match[1];
    m = +match[2];
  } else if ((match = t.match(/^(\d{1,2})$/))) {
    h = +match[1];
    m = 0;
  } else if ((match = t.match(/^(\d{1,2})(\d{2})$/))) {
    h = +match[1];
    m = +match[2];
  } else if ((match = t.match(/^(\d{1,2})\.(15|30|45)$/))) {
    // "7.30" is a clock time (07:30): .15/.30/.45 are never quarter-hour decimals.
    h = +match[1];
    m = +match[2];
  } else if ((match = t.match(/^(\d{1,2})?\.(\d+)$/))) {
    const value = parseFloat(t); // decimal hours as in the workbook: 7.5 = 07:30
    h = Math.floor(value);
    m = Math.round((value - h) * 60);
  } else {
    return null;
  }
  if (h > 24 || m >= 60 || (h === 24 && m > 0)) return null;
  return h + m / 60;
}

/** 7.5 -> "07:30"; 30 -> "06:00" (the overnight flag is shown separately). */
export function formatClock(hours: number | null | undefined): string {
  if (hours === null || hours === undefined || Number.isNaN(hours)) return "";
  const total = Math.round(hours * 60);
  const minutes = ((total % 1440) + 1440) % 1440;
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/** "07:00–03:00 +1" for a shift. */
export function formatShift(tin: unknown, tout: unknown): string {
  if (typeof tin !== "number" || typeof tout !== "number") return "—";
  return `${formatClock(tin)}–${formatClock(tout)}${tout >= 24 ? " +1" : ""}`;
}

export const onQuarter = (hours: number) => Math.abs(hours * 4 - Math.round(hours * 4)) < 1e-9;

export function fmtHours(value: unknown): string {
  if (typeof value !== "number") return "—";
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
}

/** Step a clock text by ±15 minutes (arrow keys). */
export function stepClock(text: string, delta: number): string {
  const value = parseClock(text) ?? 0;
  const next = Math.min(24, Math.max(0, Math.round((value + delta) * 4) / 4));
  return formatClock(next);
}

/** Effective hours per PLAN.md §5.5 (rules.effective_hours). Only used to prefill an activity's
 * hours instantly; every number shown or written comes from the server's preview. */
export function effectiveHours(tin: number, tout: number, additional = 0): number {
  if (tout > 22) return tout - tin - 2 + additional;
  if (tout > 12) return tout - tin + additional - 1;
  return tout - tin + additional;
}
