import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { createGaussianWorld, decodeSpz, decodeSpzData } from "../app/gaussian";

function fixture(version = 2, count = 1, degree = 0): Uint8Array<ArrayBuffer> {
  const rotationBytes = version === 2 ? 3 : 4;
  const bytes = new Uint8Array(16 + count * (16 + rotationBytes + ((degree + 1) ** 2 - 1) * 3));
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x5053474e, true);
  view.setUint32(4, version, true);
  view.setUint32(8, count, true);
  bytes[12] = degree;
  bytes[13] = 12;
  for (let i = 0; i < count; i++) {
    for (let j = 0; j < 3; j++) {
      const fixed = Math.round(([1.25, -2.5, -0.125][j] ?? 0) * 4096);
      const p = 16 + i * 9 + j * 3;
      bytes[p] = fixed & 255;
      bytes[p + 1] = (fixed >> 8) & 255;
      bytes[p + 2] = (fixed >> 16) & 255;
    }
    bytes[16 + count * 9 + i] = 204;
    bytes.set([128, 180, 30], 16 + count * 10 + i * 3);
    bytes.set([160, 144, 128], 16 + count * 13 + i * 3);
    if (version === 2) bytes.set([128, 128, 128], 16 + count * 16 + i * 3);
    else view.setUint32(16 + count * 16 + i * 4, 3 << 30, true);
  }
  return bytes;
}

function gzip(bytes: Uint8Array): ArrayBuffer {
  return new Uint8Array(gzipSync(bytes)).buffer;
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("sandbox-safe SPZ decoder", () => {
  it("decodes v2 gzip positions, opacity, DC color, scales and normalized xyzw", async () => {
    const bytes = fixture();
    // Signed 24-bit position including the largest negative representable value.
    bytes.set([0x00, 0x14, 0x00, 0x00, 0xd8, 0xff, 0x00, 0x00, 0x80], 16);
    const cloud = await decodeSpz(gzip(bytes));
    expect(cloud.version).toBe(2);
    expect(cloud.count).toBe(1);
    expect(Array.from(cloud.positions)).toEqual([1.25, -2.5, -2048]);
    expect(cloud.alphas[0]).toBeCloseTo(0.8);
    expect(cloud.scales[0]).toBeCloseTo(1);
    expect(cloud.scales[1]).toBeCloseTo(Math.exp(-1));
    expect(cloud.scales[2]).toBeCloseTo(Math.exp(-2));
    expect(cloud.colors[0]).toBeCloseTo(0.5 + 0.28209479177387814 * (128 / 255 - 0.5) / 0.15);
    expect(cloud.colors[2]).toBe(0);
    expect(Math.hypot(...cloud.rotations)).toBeCloseTo(1);
    expect(cloud.rotations[3]).toBeGreaterThan(0.99);
  });

  it("decodes v3 smallest-three sign-magnitude quaternions for every omitted component", () => {
    for (let largest = 0; largest < 4; largest++) {
      const bytes = fixture(3);
      const view = new DataView(bytes.buffer);
      // The first encoded component is negative; the next two are positive.
      const packed = (largest << 30) | ((512 | 100) << 20) | (200 << 10) | 300;
      view.setUint32(32, packed, true);
      const cloud = decodeSpzData(bytes);
      const expected: number[] = [];
      let encoded = 0;
      const values = [-100, 200, 300];
      let sum = 0;
      for (let component = 0; component < 4; component++) {
        if (component === largest) continue;
        const value = (values[encoded++] ?? 0) * Math.SQRT1_2 / 511;
        expected[component] = value;
        sum += value * value;
      }
      expected[largest] = Math.sqrt(1 - sum);
      for (let component = 0; component < 4; component++) expect(cloud.rotations[component]).toBeCloseTo(expected[component] ?? 0);
    }
  });

  it("accepts and validates SH payloads without using view-dependent SH", () => {
    const bytes = fixture(3, 1, 4);
    bytes[14] = 1;
    const cloud = decodeSpzData(bytes);
    expect(cloud.shDegree).toBe(4);
    expect(cloud.antialiased).toBe(true);
    expect(() => decodeSpzData(bytes.subarray(0, -1))).toThrow("Truncated");
  });

  it("rejects malformed, unsupported and truncated inputs before attribute allocations", async () => {
    expect(() => decodeSpzData(new Uint8Array(15))).toThrow("header");
    const cases: Array<[number, number, string]> = [
      [0, 0, "magic"], [4, 4, "version"], [8, 0, "point count"],
      [8, 1_000_001, "point count"], [12, 9, "SH degree"],
      [13, 25, "fractional"], [14, 2, "flags/extensions"], [15, 1, "flags/extensions"],
    ];
    for (const [offset, value, message] of cases) {
      const bytes = fixture();
      const view = new DataView(bytes.buffer);
      if (offset <= 8) view.setUint32(offset, value, true);
      else view.setUint8(offset, value);
      expect(() => decodeSpzData(bytes)).toThrow(message);
    }
    expect(() => decodeSpzData(fixture().subarray(0, -1))).toThrow("Truncated");
    const extra = new Uint8Array(fixture().length + 1);
    extra.set(fixture());
    expect(() => decodeSpzData(extra)).toThrow("trailing");
    await expect(decodeSpz(new ArrayBuffer(0))).rejects.toThrow("gzip");
    const compressed = new Uint8Array(gzip(fixture()));
    await expect(decodeSpz(compressed.slice(0, -5).buffer)).rejects.toThrow();
    const invalidQuaternion = fixture(3);
    new DataView(invalidQuaternion.buffer).setUint32(32, 0xffffffff, true);
    expect(() => decodeSpzData(invalidQuaternion)).toThrow("quaternion");
  });
});

describe("GaussianWorld lifecycle and depth ordering", () => {
  it("downloads without credentials, sorts far-to-near with parent transforms, throttles and disposes", async () => {
    const bytes = fixture(2, 3);
    // Place centers at z = -1, -3, -2.
    const zs = [-1, -3, -2];
    for (let i = 0; i < 3; i++) {
      const fixed = (zs[i] ?? 0) * 4096;
      bytes.set([fixed & 255, (fixed >> 8) & 255, (fixed >> 16) & 255], 16 + i * 9 + 6);
    }
    const fetchMock = vi.fn().mockResolvedValue(new Response(gzip(bytes)));
    vi.stubGlobal("fetch", fetchMock);
    const now = vi.spyOn(performance, "now").mockReturnValue(0);
    const world = await createGaussianWorld("https://example.com/world.spz");
    expect(fetchMock).toHaveBeenCalledWith("https://example.com/world.spz", { mode: "cors", credentials: "omit" });
    expect(world.object).toBeInstanceOf(THREE.Mesh);
    if (!(world.object instanceof THREE.Mesh)) throw new Error("Expected mesh");
    const geometry = world.object.geometry;
    const indices = geometry.getAttribute("splatIndex");
    const camera = new THREE.PerspectiveCamera();
    world.update(camera, new THREE.Vector2(800, 600));
    expect(Array.from(indices.array)).toEqual([1, 2, 0]);
    const parent = new THREE.Group();
    parent.add(world.object);
    parent.quaternion.set(1, 0, 0, 0);
    parent.scale.setScalar(2.430264711380005);
    now.mockReturnValue(149);
    world.update(camera, new THREE.Vector2(1600, 1200));
    expect(Array.from(indices.array)).toEqual([1, 2, 0]);
    now.mockReturnValue(150);
    world.update(camera, new THREE.Vector2(1600, 1200));
    expect(Array.from(indices.array)).toEqual([0, 2, 1]);
    const geometryDispose = vi.fn();
    geometry.addEventListener("dispose", geometryDispose);
    world.dispose();
    world.dispose();
    expect(geometryDispose).toHaveBeenCalledTimes(1);
    expect(parent.children).toHaveLength(0);
    world.update(camera, new THREE.Vector2(800, 600));
  });

  it("rejects failed HTTP downloads", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 403 })));
    await expect(createGaussianWorld("https://example.com/world.spz")).rejects.toThrow("403");
  });
});
