import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const svg = readFileSync(
  new URL("../app/neighborhood.svg", import.meta.url),
  "utf8",
);

describe("bundled neighborhood map", () => {
  it("uses real OSM cartography with attribution and no meeting-location marker", () => {
    expect(svg).toContain("Mission District, San Francisco");
    expect(svg).toContain("OpenStreetMap contributors");
    expect(svg).toContain("16th Street");
    expect((svg.match(/<path /g) ?? []).length).toBeGreaterThan(2000);
    expect(svg).not.toContain("700 Alabama");
    expect(svg).not.toContain("data-marker");
  });
  it("requires no remote tiles, scripts or API key at runtime", () => {
    expect(svg).not.toContain("<script");
    expect(svg).not.toContain("<image");
    expect(svg).not.toMatch(/href=["']https?:/);
  });
});
