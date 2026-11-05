import * as THREE from "three";
import { decodeSpz, type SpzCloud } from "./gaussian";
import { WORLD } from "./world";

/** Approximate surface wireframe from adjacent depth samples—not a surveyed building mesh. */
export function streetSkeleton(cloud: SpzCloud): THREE.BufferGeometry {
  const cols = 78;
  const rows = 50;
  const samples = new Int32Array(cols * rows).fill(-1);
  const depths = new Float32Array(cols * rows).fill(Infinity);
  for (let i = 0; i < cloud.count; i++) {
    const x = cloud.positions[i * 3] ?? 0;
    const y = cloud.positions[i * 3 + 1] ?? 0;
    const z = cloud.positions[i * 3 + 2] ?? 0;
    if (z < 0.65 || z > 65 || (cloud.alphas[i] ?? 0) < 0.5) continue;
    const u = Math.floor(((x / z + 1.7) / 3.4) * cols);
    const v = Math.floor(((y / z + 1.25) / 2.5) * rows);
    if (u < 0 || u >= cols || v < 0 || v >= rows) continue;
    const cell = v * cols + u;
    if (z < (depths[cell] ?? Infinity)) {
      depths[cell] = z;
      samples[cell] = i;
    }
  }
  const points: number[] = [];
  const colors: number[] = [];
  const color = new THREE.Color("#72846f");
  const connect = (a: number, b: number) => {
    const ia = samples[a] ?? -1;
    const ib = samples[b] ?? -1;
    if (ia < 0 || ib < 0) return;
    const ax = cloud.positions[ia * 3] ?? 0,
      ay = cloud.positions[ia * 3 + 1] ?? 0,
      az = cloud.positions[ia * 3 + 2] ?? 0;
    const bx = cloud.positions[ib * 3] ?? 0,
      by = cloud.positions[ib * 3 + 1] ?? 0,
      bz = cloud.positions[ib * 3 + 2] ?? 0;
    // Never stitch across depth discontinuities (windows, trees, horizon).
    const limit = Math.min(3, 0.2 + Math.min(az, bz) * 0.14);
    if (Math.hypot(ax - bx, ay - by, az - bz) > limit) return;
    points.push(ax, ay, az, bx, by, bz);
    const fade = THREE.MathUtils.clamp(1 - Math.max(az, bz) / 90, 0.2, 1);
    for (let i = 0; i < 2; i++)
      colors.push(
        color.r * fade + 0.7 * (1 - fade),
        color.g * fade + 0.74 * (1 - fade),
        color.b * fade + 0.68 * (1 - fade),
      );
  };
  for (let v = 0; v < rows - 1; v++)
    for (let u = 0; u < cols - 1; u++) {
      const cell = v * cols + u;
      connect(cell, cell + 1);
      connect(cell, cell + cols);
      if ((u + v) % 3 === 0) connect(cell, cell + cols + 1);
    }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(points, 3),
  );
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  return geometry;
}

export interface StreetWorld {
  object: THREE.Group;
  update(camera: THREE.PerspectiveCamera, viewport: THREE.Vector2): void;
  dispose(): void;
}

export async function createStreetWorld(): Promise<StreetWorld> {
  const response = await fetch(WORLD.splat);
  if (!response.ok) throw new Error(`Street geometry: ${response.status}`);
  const [cloud, source] = await Promise.all([
    response.arrayBuffer().then(decodeSpz),
    new THREE.TextureLoader().loadAsync(WORLD.image),
  ]);
  source.colorSpace = THREE.SRGBColorSpace;
  const object = new THREE.Group();
  object.name = "Street skeleton and source photos";
  const skeleton = new THREE.LineSegments(
    streetSkeleton(cloud),
    new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
    }),
  );
  skeleton.quaternion.set(1, 0, 0, 0);
  skeleton.scale.setScalar(WORLD.metricScale);
  object.add(skeleton);

  // Three views of ONE source image, not three separately captured photos.
  const crops = [
    {
      x: -4.1,
      y: 1.25,
      z: -10.8,
      w: 3.7,
      h: 2.5,
      crop: [0.03, 0.28, 0.37, 0.38],
      tilt: -0.025,
    },
    {
      x: 0.05,
      y: 1.7,
      z: -12,
      w: 3.8,
      h: 2.6,
      crop: [0.28, 0.14, 0.46, 0.48],
      tilt: 0.015,
    },
    {
      x: 4.1,
      y: 1,
      z: -10.8,
      w: 3,
      h: 2.6,
      crop: [0.65, 0.19, 0.34, 0.45],
      tilt: 0.025,
    },
  ];
  const textures: THREE.Texture[] = [source];
  const frames: { group: THREE.Group; x: number; y: number; z: number }[] = [];
  for (const spec of crops) {
    const texture = source.clone();
    texture.repeat.set(spec.crop[2] ?? 1, spec.crop[3] ?? 1);
    texture.offset.set(spec.crop[0] ?? 0, spec.crop[1] ?? 0);
    texture.needsUpdate = true;
    textures.push(texture);
    const frame = new THREE.Group();
    frame.position.set(spec.x, spec.y, spec.z);
    frame.rotation.z = spec.tilt;
    const border = new THREE.Mesh(
      new THREE.PlaneGeometry(spec.w + 0.08, spec.h + 0.08),
      new THREE.MeshBasicMaterial({ color: "#ffffff", side: THREE.DoubleSide }),
    );
    border.position.z = -0.01;
    frame.add(border);
    const photo = new THREE.Mesh(
      new THREE.PlaneGeometry(spec.w, spec.h),
      new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide }),
    );
    photo.name = "Crop of source image";
    frames.push({ group: frame, x: spec.x, y: spec.y, z: spec.z });
    frame.add(photo);
    object.add(frame);
  }
  let disposed = false;
  return {
    object,
    update(camera) {
      const portrait = camera.aspect < 0.8;
      for (const frame of frames) {
        frame.group.position.set(
          frame.x * (portrait ? 0.46 : 1),
          frame.y + (portrait ? 1 : 0),
          frame.z,
        );
        frame.group.scale.setScalar(portrait ? 0.6 : 1);
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      object.removeFromParent();
      object.traverse((child) => {
        if (
          child instanceof THREE.Mesh ||
          child instanceof THREE.LineSegments
        ) {
          child.geometry.dispose();
          if (Array.isArray(child.material))
            child.material.forEach((material) => material.dispose());
          else child.material.dispose();
        }
      });
      textures.forEach((texture) => texture.dispose());
    },
  };
}
