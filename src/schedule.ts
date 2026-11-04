// Picks the next open coffee slot. Kept dependency-free so it runs on Workers.

/** Local start hours offered each weekday. */
export const SLOT_HOURS = [10, 14, 16];
export const SLOT_MINUTES = 30;
/** Never propose something sooner than this. */
export const MIN_LEAD_MS = 18 * 60 * 60 * 1000;

interface Parts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: string;
}

function zonedParts(date: Date, timeZone: string): Parts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    weekday: "short",
  });
  const get = (type: string) => fmt.formatToParts(date).find((p) => p.type === type)?.value ?? "0";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")) % 24,
    minute: Number(get("minute")),
    second: Number(get("second")),
    weekday: get("weekday"),
  };
}

function offsetMs(date: Date, timeZone: string): number {
  const p = zonedParts(date, timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - date.getTime();
}

/** Converts a wall-clock time in `timeZone` to a UTC Date (DST-safe). */
export function zonedToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const first = guess - offsetMs(new Date(guess), timeZone);
  const second = guess - offsetMs(new Date(first), timeZone);
  return new Date(second);
}

export interface Slot {
  start: Date;
  end: Date;
}

export async function proposeSlot(
  now: Date,
  timeZone: string,
  isTaken: (startIso: string) => Promise<boolean>,
): Promise<Slot> {
  for (let dayOffset = 0; dayOffset < 30; dayOffset++) {
    const day = zonedParts(new Date(now.getTime() + dayOffset * 86_400_000), timeZone);
    if (day.weekday === "Sat" || day.weekday === "Sun") continue;
    for (const hour of SLOT_HOURS) {
      const start = zonedToUtc(day.year, day.month, day.day, hour, 0, timeZone);
      if (start.getTime() - now.getTime() < MIN_LEAD_MS) continue;
      if (await isTaken(start.toISOString())) continue;
      return { start, end: new Date(start.getTime() + SLOT_MINUTES * 60_000) };
    }
  }
  throw new Error("No open coffee slots in the next 30 days");
}

/** "Thursday, Nov 5 · 10:00 AM PST" */
export function formatWhen(start: Date, timeZone: string): string {
  const day = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    month: "short",
    day: "numeric",
  }).format(start);
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(start);
  return `${day} · ${time}`;
}
