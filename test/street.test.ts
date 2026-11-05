import { describe, expect, it } from "vitest";
import { streetSkeleton } from "../app/street";
import type { SpzCloud } from "../app/gaussian";

function cloud(positions: number[]): SpzCloud {
  const count = positions.length / 3;
  return {
    count,
    version: 2,
    shDegree: 0,
    antialiased: false,
    positions: new Float32Array(positions),
    scales: new Float32Array(count * 3).fill(0.01),
    rotations: new Float32Array(count * 4),
    alphas: new Float32Array(count).fill(1),
    colors: new Float32Array(count * 3),
  };
}

describe("street skeleton", () => {
  it("connects neighboring real depth samples without fabricating positions", () => {
    const source = [0, 0, 3, 0.16, 0, 3, 0, 0.16, 3, 0.16, 0.16, 3];
    const geometry = streetSkeleton(cloud(source));
    const points = geometry.getAttribute("position");
    expect(points.count).toBeGreaterThan(0);
    for (let i = 0; i < points.count; i++) {
      const found = source.some(
        (_, index) =>
          index % 3 === 0 &&
          Math.abs((source[index] ?? 0) - points.getX(i)) < 0.00001 &&
          Math.abs((source[index + 1] ?? 0) - points.getY(i)) < 0.00001 &&
          Math.abs((source[index + 2] ?? 0) - points.getZ(i)) < 0.00001,
      );
      expect(found).toBe(true);
    }
    geometry.dispose();
  });
  it("does not stitch across a large depth jump", () => {
    const geometry = streetSkeleton(cloud([0, 0, 2, 1, 0, 20]));
    expect(geometry.getAttribute("position").count).toBe(0);
    geometry.dispose();
  });
});
