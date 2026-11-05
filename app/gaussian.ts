import * as THREE from "three";

// SPZ decoding and Gaussian projection adapted from nianticlabs/spz and
// antimatter15/splat (MIT). Full copyright notices: docs/THIRD_PARTY.md.
const MAX_POINTS = 1_000_000;
const MAX_COMPRESSED_BYTES = 32 * 1024 * 1024;
const MAX_DECODED_BYTES = 96 * 1024 * 1024;
const SH_C0 = 0.28209479177387814;

export interface SpzCloud {
  version: number;
  count: number;
  shDegree: number;
  antialiased: boolean;
  /** File coordinates, without axis flips or metric scaling. */
  positions: Float32Array;
  /** Activated standard deviations (exp of the stored log scales). */
  scales: Float32Array;
  /** Normalized xyzw quaternions. */
  rotations: Float32Array;
  /** Display-space RGB, clamped to [0, 1]; only SH DC is used. */
  colors: Float32Array;
  /** Activated opacity in [0, 1]. */
  alphas: Float32Array;
}

async function readBounded(
  stream: ReadableStream<Uint8Array>,
  limit: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit)
        throw new Error("SPZ exceeds the supported byte limit");
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/** Decode a gzip-compressed SPZ v2/v3 using only the browser's native gzip API. */
export async function decodeSpz(compressed: ArrayBuffer): Promise<SpzCloud> {
  if (compressed.byteLength > MAX_COMPRESSED_BYTES)
    throw new Error("SPZ compressed file is too large");
  const magic = new Uint8Array(
    compressed,
    0,
    Math.min(2, compressed.byteLength),
  );
  if (magic[0] !== 0x1f || magic[1] !== 0x8b)
    throw new Error("SPZ must be gzip compressed");
  const stream = new Blob([compressed])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"));
  return decodeSpzData(await readBounded(stream, MAX_DECODED_BYTES));
}

/** Parse the uncompressed legacy 16-byte SPZ header and attribute streams. */
export function decodeSpzData(bytes: Uint8Array): SpzCloud {
  if (bytes.byteLength < 16) throw new Error("Truncated SPZ header");
  if (bytes.byteLength > MAX_DECODED_BYTES)
    throw new Error("SPZ decompressed file is too large");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x5053474e)
    throw new Error("Invalid SPZ magic");
  const version = view.getUint32(4, true);
  const count = view.getUint32(8, true);
  const shDegree = view.getUint8(12);
  const fractionalBits = view.getUint8(13);
  const flags = view.getUint8(14);
  if (version !== 2 && version !== 3)
    throw new Error(`Unsupported SPZ version ${version}`);
  if (count === 0 || count > MAX_POINTS)
    throw new Error("Invalid SPZ point count");
  if (shDegree > (version === 2 ? 3 : 4))
    throw new Error("Invalid SPZ SH degree");
  if (fractionalBits > 24) throw new Error("Invalid SPZ fractional bits");
  // Extensions can change the coordinate convention; never silently misinterpret them.
  if ((flags & ~1) !== 0 || view.getUint8(15) !== 0)
    throw new Error("Unsupported SPZ flags/extensions");
  const rotationBytes = version === 2 ? 3 : 4;
  const shBytes = ((shDegree + 1) ** 2 - 1) * 3;
  const expected = 16 + count * (9 + 1 + 3 + 3 + rotationBytes + shBytes);
  if (bytes.byteLength < expected)
    throw new Error("Truncated SPZ attribute data");
  if (bytes.byteLength !== expected)
    throw new Error("Unexpected trailing SPZ data");
  const alphaOffset = 16 + count * 9;
  const colorOffset = alphaOffset + count;
  const scaleOffset = colorOffset + count * 3;
  const rotationOffset = scaleOffset + count * 3;
  const positions = new Float32Array(count * 3);
  const scales = new Float32Array(count * 3);
  const rotations = new Float32Array(count * 4);
  const colors = new Float32Array(count * 3);
  const alphas = new Float32Array(count);
  const unit = 2 ** -fractionalBits;
  for (let i = 0; i < count * 3; i++) {
    const p = 16 + i * 3;
    const fixed =
      view.getUint8(p) |
      (view.getUint8(p + 1) << 8) |
      (view.getInt8(p + 2) << 16);
    positions[i] = fixed * unit;
    scales[i] = Math.exp(view.getUint8(scaleOffset + i) / 16 - 10);
    const dc = (view.getUint8(colorOffset + i) / 255 - 0.5) / 0.15;
    colors[i] = THREE.MathUtils.clamp(0.5 + SH_C0 * dc, 0, 1);
  }
  const q: [number, number, number, number] = [0, 0, 0, 1];
  for (let i = 0; i < count; i++) {
    alphas[i] = view.getUint8(alphaOffset + i) / 255;
    const offset = rotationOffset + i * rotationBytes;
    if (version === 2) {
      q[0] = view.getUint8(offset) / 127.5 - 1;
      q[1] = view.getUint8(offset + 1) / 127.5 - 1;
      q[2] = view.getUint8(offset + 2) / 127.5 - 1;
      q[3] = Math.sqrt(Math.max(0, 1 - q[0] ** 2 - q[1] ** 2 - q[2] ** 2));
    } else {
      let packed = view.getUint32(offset, true);
      const largest = packed >>> 30;
      let sum = 0;
      for (let component = 3; component >= 0; component--) {
        if (component === largest) continue;
        const v =
          (((packed & 511) * Math.SQRT1_2) / 511) * (packed & 512 ? -1 : 1);
        q[component] = v;
        sum += v * v;
        packed >>>= 10;
      }
      if (sum > 1.01) throw new Error("Invalid SPZ quaternion");
      q[largest] = Math.sqrt(Math.max(0, 1 - sum));
    }
    const norm = Math.hypot(q[0], q[1], q[2], q[3]);
    for (let component = 0; component < 4; component++)
      rotations[i * 4 + component] = (q[component] ?? 0) / norm;
  }
  return {
    version,
    count,
    shDegree,
    antialiased: (flags & 1) !== 0,
    positions,
    scales,
    rotations,
    colors,
    alphas,
  };
}

const vertexShader = /* glsl */ `
  uniform sampler2D splatData;
  uniform vec2 viewport;
  uniform float textureWidth;
  uniform bool antialiased;
  attribute float splatIndex;
  varying vec2 gaussianPosition;
  varying vec4 gaussianColor;

  vec4 readSplat(float texel) {
    return texture2D(splatData, (vec2(mod(texel, textureWidth), floor(texel / textureWidth)) + 0.5)
      / vec2(textureWidth, float(textureSize(splatData, 0).y)));
  }
  void main() {
    gaussianPosition = position.xy * 3.0;
    gaussianColor = vec4(0.0);
    gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
    float base = splatIndex * 4.0;
    vec4 centerAlpha = readSplat(base);
    vec4 cam = modelViewMatrix * vec4(centerAlpha.xyz, 1.0);
    vec4 clip = projectionMatrix * cam;
    if (clip.w <= 0.0 || clip.z < -clip.w || clip.z > clip.w) return;
    vec4 a = readSplat(base + 2.0);
    vec4 b = readSplat(base + 3.0);
    mat3 covariance = mat3(a.x, a.y, a.z, a.y, a.w, b.x, a.z, b.x, b.y);
    mat3 transform = mat3(modelViewMatrix);
    covariance = transform * covariance * transpose(transform);
    // Jacobian of Three's -Z perspective projection, in drawing-buffer pixels.
    vec2 focal = 0.5 * viewport * vec2(projectionMatrix[0][0], projectionMatrix[1][1]);
    vec2 slope = clamp(cam.xy / -cam.z, -1.3 * viewport / (2.0 * focal), 1.3 * viewport / (2.0 * focal));
    vec3 jx = vec3(focal.x / -cam.z, 0.0, focal.x * slope.x / -cam.z);
    vec3 jy = vec3(0.0, focal.y / -cam.z, focal.y * slope.y / -cam.z);
    float xx = dot(jx, covariance * jx);
    float xy = dot(jx, covariance * jy);
    float yy = dot(jy, covariance * jy);
    float determinant = max(0.0, xx * yy - xy * xy);
    xx += 0.3;
    yy += 0.3;
    float opacity = centerAlpha.w;
    if (antialiased) opacity *= sqrt(determinant / max(1e-12, xx * yy - xy * xy));
    float mid = 0.5 * (xx + yy);
    float radius = length(vec2(0.5 * (xx - yy), xy));
    float major = max(0.0, mid + radius);
    float minor = max(0.0, mid - radius);
    // atan handles diagonal/isotropic covariances without normalizing a zero vector.
    float angle = (abs(xy) + abs(xx - yy) < 1e-8) ? 0.0 : 0.5 * atan(2.0 * xy, xx - yy);
    vec2 axis = vec2(cos(angle), sin(angle));
    vec2 radii = min(3.0 * sqrt(vec2(major, minor)), vec2(128.0));
    vec2 offset = position.x * radii.x * axis + position.y * radii.y * vec2(-axis.y, axis.x);
    vec2 ndc = clip.xy / clip.w;
    vec2 extent = 2.0 * (abs(axis) * radii.x + abs(vec2(-axis.y, axis.x)) * radii.y) / viewport;
    if (any(greaterThan(abs(ndc), vec2(1.0) + extent))) return;
    gaussianColor = vec4(readSplat(base + 1.0).rgb, opacity);
    gl_Position = clip;
    gl_Position.xy += offset * 2.0 / viewport * clip.w;
  }
`;

const fragmentShader = /* glsl */ `
  varying vec2 gaussianPosition;
  varying vec4 gaussianColor;
  void main() {
    float radiusSquared = dot(gaussianPosition, gaussianPosition);
    if (radiusSquared > 9.0) discard;
    float alpha = min(0.99, gaussianColor.a * exp(-0.5 * radiusSquared));
    if (alpha < 1.0 / 255.0) discard;
    gl_FragColor = vec4(gaussianColor.rgb, alpha);
    #include <colorspace_fragment>
  }
`;

export interface GaussianWorld {
  object: THREE.Object3D;
  /** Call after camera/parent transforms change, immediately before render.
   * viewport is the renderer drawing-buffer size, NOT CSS size. */
  update(camera: THREE.PerspectiveCamera, viewport: THREE.Vector2): void;
  dispose(): void;
}

/** No workers, WASM, dynamic code evaluation, or remote JS dependencies. WebGL2 required. */
export async function createGaussianWorld(url: string): Promise<GaussianWorld> {
  const response = await fetch(url, { mode: "cors", credentials: "omit" });
  if (!response.ok) throw new Error(`SPZ download failed (${response.status})`);
  if (!response.body) throw new Error("SPZ response has no body");
  const compressed = await readBounded(response.body, MAX_COMPRESSED_BYTES);
  const cloud = await decodeSpz(compressed.buffer);
  const width = 2048;
  const height = Math.ceil((cloud.count * 4) / width);
  const data = new Float32Array(width * height * 4);
  const matrix = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const origin = new THREE.Vector3();
  const color = new THREE.Color();
  for (let i = 0; i < cloud.count; i++) {
    const p = i * 3;
    const t = i * 16;
    data[t] = cloud.positions[p] ?? 0;
    data[t + 1] = cloud.positions[p + 1] ?? 0;
    data[t + 2] = cloud.positions[p + 2] ?? 0;
    data[t + 3] = cloud.alphas[i] ?? 0;
    color.setRGB(
      cloud.colors[p] ?? 0,
      cloud.colors[p + 1] ?? 0,
      cloud.colors[p + 2] ?? 0,
      THREE.SRGBColorSpace,
    );
    data[t + 4] = color.r;
    data[t + 5] = color.g;
    data[t + 6] = color.b;
    q.fromArray(cloud.rotations, i * 4);
    scale.fromArray(cloud.scales, p);
    matrix.compose(origin, q, scale);
    const m = matrix.elements;
    // Sigma = (R S) (R S)^T, stored as xx, xy, xz, yy, yz, zz.
    data[t + 8] = m[0] ** 2 + m[4] ** 2 + m[8] ** 2;
    data[t + 9] = m[0] * m[1] + m[4] * m[5] + m[8] * m[9];
    data[t + 10] = m[0] * m[2] + m[4] * m[6] + m[8] * m[10];
    data[t + 11] = m[1] ** 2 + m[5] ** 2 + m[9] ** 2;
    data[t + 12] = m[1] * m[2] + m[5] * m[6] + m[9] * m[10];
    data[t + 13] = m[2] ** 2 + m[6] ** 2 + m[10] ** 2;
  }
  const texture = new THREE.DataTexture(
    data,
    width,
    height,
    THREE.RGBAFormat,
    THREE.FloatType,
  );
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  const order = new Uint32Array(cloud.count);
  const indices = new Float32Array(cloud.count);
  const depths = new Float32Array(cloud.count);
  for (let i = 0; i < cloud.count; i++) {
    order[i] = i;
    indices[i] = i;
  }
  const indexAttribute = new THREE.InstancedBufferAttribute(
    indices,
    1,
  ).setUsage(THREE.DynamicDrawUsage);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(
      [-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0],
      3,
    ),
  );
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.setAttribute("splatIndex", indexAttribute);
  geometry.instanceCount = cloud.count;
  const viewportUniform = { value: new THREE.Vector2(1, 1) };
  const material = new THREE.ShaderMaterial({
    uniforms: {
      splatData: { value: texture },
      textureWidth: { value: width },
      viewport: viewportUniform,
      antialiased: { value: cloud.antialiased },
    },
    vertexShader,
    fragmentShader,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const object = new THREE.Mesh(geometry, material);
  object.name = "GaussianWorld";
  object.frustumCulled = false;
  const modelView = new THREE.Matrix4();
  const lastSorted = new THREE.Matrix4();
  let lastSortTime = -Infinity;
  let disposed = false;
  return {
    object,
    update(camera, viewport) {
      if (disposed) return;
      viewportUniform.value.set(
        Math.max(1, viewport.x),
        Math.max(1, viewport.y),
      );
      camera.updateWorldMatrix(true, false);
      object.updateWorldMatrix(true, false);
      modelView.multiplyMatrices(camera.matrixWorldInverse, object.matrixWorld);
      const now = performance.now();
      if (
        now - lastSortTime < 150 ||
        (lastSortTime !== -Infinity && modelView.equals(lastSorted))
      )
        return;
      const m = modelView.elements;
      for (let i = 0; i < cloud.count; i++) {
        const p = i * 3;
        depths[i] =
          m[2] * (cloud.positions[p] ?? 0) +
          m[6] * (cloud.positions[p + 1] ?? 0) +
          m[10] * (cloud.positions[p + 2] ?? 0) +
          m[14];
      }
      // Three camera looks along -Z: more negative camera-space Z is farther away.
      order.sort((a, b) => (depths[a] ?? 0) - (depths[b] ?? 0));
      for (let i = 0; i < cloud.count; i++) indices[i] = order[i] ?? 0;
      indexAttribute.needsUpdate = true;
      lastSorted.copy(modelView);
      lastSortTime = now;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      object.removeFromParent();
      geometry.dispose();
      material.dispose();
      texture.dispose();
    },
  };
}
