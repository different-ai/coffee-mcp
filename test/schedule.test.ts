import { describe, expect, it } from "vitest";
import { formatWhen, proposeSlot, zonedToUtc } from "../src/schedule";
import { TUESDAY_9AM_PT } from "./helpers";

const TZ = "America/Los_Angeles";
const free = async () => false;

describe("zonedToUtc", () => {
  it("handles standard and daylight time", () => {
    expect(zonedToUtc(2026, 11, 4, 10, 0, TZ).toISOString()).toBe("2026-11-04T18:00:00.000Z"); // PST
    expect(zonedToUtc(2026, 7, 1, 10, 0, TZ).toISOString()).toBe("2026-07-01T17:00:00.000Z"); // PDT
  });
});

describe("proposeSlot", () => {
  it("proposes the first slot at least 18h out", async () => {
    const slot = await proposeSlot(TUESDAY_9AM_PT, TZ, free);
    // Tue 9am -> Wed 10am PT
    expect(slot.start.toISOString()).toBe("2026-11-04T18:00:00.000Z");
    expect(slot.end.getTime() - slot.start.getTime()).toBe(30 * 60_000);
  });

  it("skips taken slots", async () => {
    const taken = new Set(["2026-11-04T18:00:00.000Z"]);
    const slot = await proposeSlot(TUESDAY_9AM_PT, TZ, async (iso) => taken.has(iso));
    expect(slot.start.toISOString()).toBe("2026-11-04T22:00:00.000Z"); // Wed 2pm PT
  });

  it("never lands on a weekend", async () => {
    const friday = new Date("2026-11-06T20:00:00Z"); // Fri noon PT
    const slot = await proposeSlot(friday, TZ, free);
    expect(formatWhen(slot.start, TZ)).toMatch(/^Monday, Nov 9 · 10:00 AM PST$/);
  });
});
