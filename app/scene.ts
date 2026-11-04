import * as THREE from "three";

export interface CoffeeScene {
  /** Pour the coffee (fills the cup, starts the steam). */
  pour(): void;
  /** Gentle camera push-in once the coffee is booked. */
  celebrate(): void;
  dispose(): void;
}

const SKY_TOP = new THREE.Color("#1d2150");
const SKY_MID = new THREE.Color("#8a5d8e");
const HORIZON = new THREE.Color("#f4ad8a");
const SUN = new THREE.Color("#ffd2a1");
const INTERNATIONAL_ORANGE = new THREE.Color("#c0362c");

function softTexture(size = 128): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  if (g) {
    const r = size / 2;
    const grad = g.createRadialGradient(r, r, 0, r, r, r);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.4, "rgba(255,255,255,0.55)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Coffee surface with crema and a latte-art heart. */
function latteTexture(): THREE.CanvasTexture {
  const size = 512;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  if (g) {
    const r = size / 2;
    const base = g.createRadialGradient(r, r, 0, r, r, r);
    base.addColorStop(0, "#b77a4c");
    base.addColorStop(0.7, "#8a5230");
    base.addColorStop(0.92, "#5a3019");
    base.addColorStop(1, "#3b1d0e");
    g.fillStyle = base;
    g.fillRect(0, 0, size, size);
    // heart
    g.save();
    g.translate(r, r + 18);
    g.scale(1.25, 1.25);
    g.fillStyle = "rgba(255,244,230,0.92)";
    g.beginPath();
    g.moveTo(0, 70);
    g.bezierCurveTo(-110, 0, -80, -95, 0, -45);
    g.bezierCurveTo(80, -95, 110, 0, 0, 70);
    g.fill();
    g.restore();
    g.strokeStyle = "rgba(138,82,48,0.85)";
    g.lineWidth = 6;
    g.beginPath();
    g.moveTo(r, r - 60);
    g.lineTo(r, r + 110);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function buildSky(sunDir: THREE.Vector3): THREE.Mesh {
  const geo = new THREE.SphereGeometry(450, 48, 24);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: SKY_TOP },
      mid: { value: SKY_MID },
      horizon: { value: HORIZON },
      sunDir: { value: sunDir },
      sunColor: { value: SUN },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 top; uniform vec3 mid; uniform vec3 horizon;
      uniform vec3 sunDir; uniform vec3 sunColor;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = max(d.y, 0.0);
        vec3 c = mix(horizon, mid, smoothstep(0.0, 0.22, h));
        c = mix(c, top, smoothstep(0.22, 0.75, h));
        float s = max(dot(d, normalize(sunDir)), 0.0);
        c += sunColor * (pow(s, 900.0) * 2.5 + pow(s, 40.0) * 0.45 + pow(s, 6.0) * 0.18);
        if (d.y < 0.0) c = horizon;
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  return new THREE.Mesh(geo, mat);
}

function buildBridge(): THREE.Group {
  const g = new THREE.Group();
  const orange = new THREE.MeshStandardMaterial({ color: INTERNATIONAL_ORANGE, roughness: 0.65, metalness: 0.15 });
  const span = 110;
  const towerH = 40;
  const deckY = 11;
  const width = 3.4;

  for (const x of [-span / 2, span / 2]) {
    for (const z of [-width / 2, width / 2]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(1.5, towerH, 1.2), orange);
      leg.position.set(x, towerH / 2, z);
      g.add(leg);
    }
    for (const h of [0.34, 0.58, 0.8, 0.97]) {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.4, width + 1.2), orange);
      beam.position.set(x, towerH * h, 0);
      g.add(beam);
    }
  }

  const deck = new THREE.Mesh(new THREE.BoxGeometry(span * 2.6, 1.3, width + 1), orange);
  deck.position.y = deckY;
  g.add(deck);

  const cableTop = towerH - 0.6;
  const sag = deckY + 1.6;
  const cableY = (x: number): number => {
    const ax = Math.abs(x);
    if (ax <= span / 2) return sag + (cableTop - sag) * (x / (span / 2)) ** 2;
    const t = (ax - span / 2) / (span * 0.75);
    return cableTop + (deckY + 1 - cableTop) * Math.min(t, 1) ** 0.85;
  };

  const suspenderXs: number[] = [];
  for (let x = -span * 1.2; x <= span * 1.2; x += 3.2) suspenderXs.push(x);

  const suspender = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 1, 0.12), orange, suspenderXs.length * 2);
  const m = new THREE.Matrix4();
  let i = 0;
  for (const z of [-width / 2, width / 2]) {
    const pts: THREE.Vector3[] = [];
    for (let x = -span * 1.25; x <= span * 1.25; x += 2) pts.push(new THREE.Vector3(x, cableY(x), z));
    const cable = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 220, 0.32, 6), orange);
    g.add(cable);
    for (const x of suspenderXs) {
      const top = cableY(x);
      const h = Math.max(top - deckY, 0.01);
      m.makeScale(1, h, 1).setPosition(x, deckY + h / 2, z);
      suspender.setMatrixAt(i++, m);
    }
  }
  g.add(suspender);
  return g;
}

function buildHills(): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: "#3e3550", roughness: 1, flatShading: true });
  const far = new THREE.MeshStandardMaterial({ color: "#6c5577", roughness: 1, flatShading: true });
  const hills: [number, number, number, number, number, number, THREE.Material][] = [
    [120, -6, -175, 70, 34, 50, mat],
    [190, -6, -210, 80, 46, 60, far],
    [70, -6, -210, 50, 24, 40, far],
    [-150, -6, -200, 70, 20, 50, far],
    [-230, -6, -230, 90, 30, 60, far],
  ];
  for (const [x, y, z, sx, sy, sz, material] of hills) {
    const hill = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), material);
    hill.scale.set(sx, sy, sz);
    hill.position.set(x, y, z);
    hill.rotation.y = x * 0.01;
    g.add(hill);
  }
  return g;
}

function buildCity(): THREE.InstancedMesh {
  const count = 70;
  const mat = new THREE.MeshStandardMaterial({ color: "#2f2a47", roughness: 0.9, emissive: "#ffb070", emissiveIntensity: 0.06 });
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, count);
  const m = new THREE.Matrix4();
  let seed = 7;
  const rand = (): number => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let i = 0; i < count; i++) {
    const w = 3 + rand() * 5;
    const h = 4 + rand() ** 2 * 26 + (i === 12 ? 30 : 0);
    const x = -150 + rand() * 75;
    const z = -150 - rand() * 40;
    m.makeScale(w, h, w).setPosition(x, -4 + h / 2, z);
    mesh.setMatrixAt(i, m);
  }
  return mesh;
}

function buildCup(): { group: THREE.Group; liquid: THREE.Mesh; stream: THREE.Mesh } {
  const group = new THREE.Group();
  const ceramic = new THREE.MeshPhysicalMaterial({
    color: "#f6f1ea",
    roughness: 0.28,
    clearcoat: 0.6,
    clearcoatRoughness: 0.2,
    side: THREE.DoubleSide,
  });

  const profile = [
    [0, 0], [0.15, 0], [0.165, 0.008], [0.18, 0.05], [0.205, 0.17], [0.222, 0.255],
    [0.226, 0.262], [0.218, 0.266], [0.205, 0.25], [0.188, 0.15], [0.165, 0.045], [0.14, 0.03], [0, 0.03],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const cup = new THREE.Mesh(new THREE.LatheGeometry(profile, 72), ceramic);
  cup.castShadow = true;
  group.add(cup);

  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.019, 16, 40, Math.PI * 1.15), ceramic);
  handle.position.set(0.21, 0.145, 0);
  handle.rotation.z = -Math.PI * 0.575;
  handle.castShadow = true;
  group.add(handle);

  const saucerProfile = [
    [0, 0], [0.2, 0], [0.3, 0.012], [0.36, 0.03], [0.372, 0.04], [0.36, 0.036], [0.3, 0.024], [0.2, 0.016], [0, 0.014],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const saucer = new THREE.Mesh(new THREE.LatheGeometry(saucerProfile, 72), ceramic);
  saucer.position.y = -0.016;
  saucer.receiveShadow = true;
  saucer.castShadow = true;
  group.add(saucer);

  const liquid = new THREE.Mesh(
    new THREE.CircleGeometry(1, 64),
    new THREE.MeshStandardMaterial({ map: latteTexture(), roughness: 0.25, metalness: 0 }),
  );
  liquid.rotation.x = -Math.PI / 2;
  liquid.visible = false;
  group.add(liquid);

  const stream = new THREE.Mesh(
    new THREE.CylinderGeometry(0.012, 0.016, 1, 12),
    new THREE.MeshStandardMaterial({ color: "#5a3019", roughness: 0.2 }),
  );
  stream.visible = false;
  group.add(stream);

  return { group, liquid, stream };
}

export function createScene(canvas: HTMLCanvasElement, opts: { reducedMotion: boolean }): CoffeeScene | null {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  } catch {
    return null;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(HORIZON, 40, 260);

  const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 900);
  const camBase = new THREE.Vector3(0, 1.62, 4.6);
  const camPush = new THREE.Vector3();
  const lookAt = new THREE.Vector3(0.1, 1.38, 0);

  const sunDir = new THREE.Vector3(-0.32, 0.055, -1).normalize();
  scene.add(buildSky(sunDir));

  // Lights: low sun behind the bridge, cool sky fill, warm key on the table.
  scene.add(new THREE.HemisphereLight("#b3acdf", "#5d3d3a", 0.85));
  const sun = new THREE.DirectionalLight("#ffb98a", 2.2);
  sun.position.copy(sunDir).multiplyScalar(100);
  scene.add(sun);
  const key = new THREE.DirectionalLight("#ffe2c6", 1.5);
  key.position.set(3.5, 5, 4);
  key.target.position.set(0.4, 0.9, 1.6);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -2;
  key.shadow.camera.right = 2;
  key.shadow.camera.top = 2;
  key.shadow.camera.bottom = -2;
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 14;
  key.shadow.bias = -0.0005;
  key.shadow.radius = 6;
  scene.add(key, key.target);
  const cupGlow = new THREE.PointLight("#ffb070", 0.6, 3, 2);
  cupGlow.position.set(0.6, 1.4, 2.2);
  scene.add(cupGlow);

  // Bay
  const waterGeo = new THREE.PlaneGeometry(700, 420, 140, 84);
  waterGeo.rotateX(-Math.PI / 2);
  const waterBase = Float32Array.from(waterGeo.attributes.position?.array ?? []);
  const water = new THREE.Mesh(
    waterGeo,
    new THREE.MeshStandardMaterial({ color: "#7484b8", roughness: 0.35, metalness: 0.05, flatShading: true }),
  );
  water.position.set(0, -4, -170);
  scene.add(water);

  const bridge = buildBridge();
  bridge.position.set(18, -4, -150);
  bridge.rotation.y = -0.2;
  scene.add(bridge);
  scene.add(buildHills());
  scene.add(buildCity());

  // Karl the Fog, rolling through the towers.
  const fogTex = softTexture();
  const fogSprites: { sprite: THREE.Sprite; speed: number }[] = [];
  for (let i = 0; i < 16; i++) {
    const mat = new THREE.SpriteMaterial({ map: fogTex, color: "#ffe9de", opacity: 0.42, transparent: true, depthWrite: false });
    const sprite = new THREE.Sprite(mat);
    const s = 40 + (i % 5) * 14;
    sprite.scale.set(s * 1.8, s * 0.55, 1);
    sprite.position.set(-160 + i * 24, 22 + (i % 4) * 7, -160 - (i % 3) * 18);
    scene.add(sprite);
    fogSprites.push({ sprite, speed: 1.2 + (i % 4) * 0.4 });
  }

  // Terrace: railing + table.
  const metal = new THREE.MeshStandardMaterial({ color: "#26222f", roughness: 0.5, metalness: 0.6 });
  const rail = new THREE.Mesh(new THREE.BoxGeometry(14, 0.06, 0.06), metal);
  rail.position.set(0, 1.05, -1.2);
  scene.add(rail);
  for (let x = -7; x <= 7; x += 1.4) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.05, 0.05), metal);
    post.position.set(x, 0.525, -1.2);
    scene.add(post);
  }
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(16, 8),
    new THREE.MeshStandardMaterial({ color: "#4a3530", roughness: 0.9 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0, 2.5);
  floor.receiveShadow = true;
  scene.add(floor);

  const wood = new THREE.MeshStandardMaterial({ color: "#8c5b3d", roughness: 0.5, metalness: 0.02 });
  const tableTop = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.25, 0.06, 72), wood);
  tableTop.position.set(0.35, 0.9, 1.5);
  tableTop.receiveShadow = true;
  scene.add(tableTop);
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 0.88, 16), metal);
  stem.position.set(0.35, 0.44, 1.5);
  scene.add(stem);

  const { group: cup, liquid, stream } = buildCup();
  cup.position.set(0.55, 0.947, 2.05);
  cup.rotation.y = -0.5;
  scene.add(cup);

  // Steam
  const steamTex = softTexture(64);
  const steam: { sprite: THREE.Sprite; phase: number }[] = [];
  for (let i = 0; i < 18; i++) {
    const mat = new THREE.SpriteMaterial({ map: steamTex, color: "#ffffff", opacity: 0, transparent: true, depthWrite: false });
    const sprite = new THREE.Sprite(mat);
    scene.add(sprite);
    steam.push({ sprite, phase: i / 18 });
  }

  // State
  const motion = opts.reducedMotion ? 0 : 1;
  let fill = 0; // 0..1
  let fillTarget = 0;
  let steamLevel = 0;
  let pouring = 0;
  let pushTarget = 0;
  let push = 0;
  const pointer = new THREE.Vector2();
  const pointerTarget = new THREE.Vector2();

  const onPointer = (e: PointerEvent): void => {
    const rect = canvas.getBoundingClientRect();
    pointerTarget.set(((e.clientX - rect.left) / rect.width) * 2 - 1, ((e.clientY - rect.top) / rect.height) * 2 - 1);
  };
  window.addEventListener("pointermove", onPointer, { passive: true });

  const resize = (): void => {
    const parent = canvas.parentElement;
    const w = parent?.clientWidth ?? 800;
    const h = parent?.clientHeight ?? 540;
    renderer.setSize(w, h, false);
    const aspect = w / h;
    camera.aspect = aspect;
    camera.fov = aspect < 1 ? 50 : 38;
    // Portrait: aim lower so the cup sits above the email card.
    camBase.set(aspect < 1 ? 0.55 : 0, aspect < 1 ? 1.75 : 1.62, aspect < 1 ? 4.7 : 4.6);
    lookAt.set(aspect < 1 ? 0.5 : 0.1, aspect < 1 ? 1.2 : 1.38, 0);
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize);
  if (canvas.parentElement) ro.observe(canvas.parentElement);
  resize();

  let visible = true;
  const io = new IntersectionObserver((entries) => {
    visible = entries.some((e) => e.isIntersecting);
  });
  io.observe(canvas);

  const clock = new THREE.Clock();
  let raf = 0;
  const positions = waterGeo.attributes.position;

  const frame = (): void => {
    raf = requestAnimationFrame(frame);
    if (!visible || document.hidden) {
      clock.getDelta();
      return;
    }
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;

    // Water swell
    if (motion && positions) {
      for (let i = 0; i < positions.count; i++) {
        const x = waterBase[i * 3] ?? 0;
        const z = waterBase[i * 3 + 2] ?? 0;
        positions.setY(i, Math.sin(x * 0.045 + t * 0.55) * 0.45 + Math.cos(z * 0.06 + t * 0.4) * 0.35 + Math.sin((x + z) * 0.11 + t) * 0.12);
      }
      positions.needsUpdate = true;
    }

    for (const f of fogSprites) {
      f.sprite.position.x += f.speed * dt * motion;
      if (f.sprite.position.x > 200) f.sprite.position.x = -200;
    }

    // Pour
    if (pouring > 0) {
      pouring = Math.max(pouring - dt, 0);
      fillTarget = 1;
    }
    fill += (fillTarget - fill) * Math.min(dt * (motion ? 1.6 : 60), 1);
    const liquidY = 0.035 + fill * 0.2;
    const radius = 0.15 + fill * 0.052;
    liquid.visible = fill > 0.01;
    liquid.position.y = liquidY;
    liquid.scale.setScalar(radius);
    liquid.rotation.z = t * 0.05 * motion;
    stream.visible = pouring > 0.15 && motion > 0;
    stream.position.set(0.02, liquidY + 0.32, 0);
    stream.scale.y = 0.64;

    steamLevel += ((fill > 0.6 ? 1 : 0) - steamLevel) * Math.min(dt * 0.8, 1);
    for (const s of steam) {
      const p = (s.phase + t * 0.12 * (motion || 0.0001)) % 1;
      s.sprite.position.set(
        cup.position.x + Math.sin(p * 6 + s.phase * 20) * 0.05 * (0.4 + p),
        cup.position.y + 0.28 + p * 0.75,
        cup.position.z + Math.cos(p * 5 + s.phase * 13) * 0.04,
      );
      const size = 0.08 + p * 0.28;
      s.sprite.scale.set(size, size, 1);
      s.sprite.material.opacity = steamLevel * 0.22 * Math.sin(p * Math.PI);
    }

    // Camera
    pointer.lerp(pointerTarget, Math.min(dt * 2.5, 1));
    push += (pushTarget - push) * Math.min(dt * 1.2, 1);
    camPush.set(0.12 * push, -0.06 * push, -0.7 * push);
    camera.position
      .copy(camBase)
      .add(camPush)
      .add(new THREE.Vector3(pointer.x * 0.22 * motion + Math.sin(t * 0.21) * 0.04 * motion, -pointer.y * 0.1 * motion, 0));
    camera.lookAt(lookAt.x + 0.12 * push, lookAt.y - 0.1 * push, lookAt.z);

    renderer.render(scene, camera);
  };
  frame();

  return {
    pour() {
      pouring = 1.8;
      if (!motion) fill = fillTarget = 1;
    },
    celebrate() {
      pushTarget = 1;
    },
    dispose() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      window.removeEventListener("pointermove", onPointer);
      renderer.dispose();
    },
  };
}
