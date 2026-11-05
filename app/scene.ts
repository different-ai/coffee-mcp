import * as THREE from "three";
import { createStreetWorld, type StreetWorld } from "./street";

export interface CoffeeScene {
  pour(): void;
  celebrate(): void;
  dispose(): void;
}

/** Reconstruction-derived street wireframe with world-anchored source-image crops. */
export function createScene(
  canvas: HTMLCanvasElement,
  opts: {
    reducedMotion: boolean;
    onStatus?: (status: "loading" | "ready" | "fallback") => void;
  },
): CoffeeScene | null {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
    });
  } catch {
    opts.onStatus?.("fallback");
    return null;
  }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#edf0e8");
  scene.fog = new THREE.Fog("#edf0e8", 25, 120);
  const camera = new THREE.PerspectiveCamera(65, 1, 0.05, 300);
  opts.onStatus?.("loading");
  // Pure JS decoding/sorting: MCP sandboxes need neither WASM nor unsafe-eval.
  let world: StreetWorld | undefined;
  const viewport = new THREE.Vector2();

  let loaded = false;
  let presented = false;
  let disposed = false;
  const fallbackTimer = window.setTimeout(() => {
    if (!loaded) opts.onStatus?.("fallback");
  }, 15000);
  createStreetWorld()
    .then((asset) => {
      if (disposed) return asset.dispose();
      world = asset;
      scene.add(asset.object);
      loaded = true;
      window.clearTimeout(fallbackTimer);
    })
    .catch((error: unknown) => {
      console.warn("Splat scene unavailable; using the source image", error);
      opts.onStatus?.("fallback");
    });

  // Camera remains close to the generation origin, where the world is most complete.
  let yaw = 0;
  let pitch = 0;
  let targetYaw = 0;
  let targetPitch = 0;
  let push = 0;
  let pushTarget = 0;
  let lastTime = performance.now();
  let elapsed = 0;
  let dragging = false;
  let dragX = 0;
  let dragY = 0;
  let startYaw = 0;
  let startPitch = 0;
  const direction = new THREE.Vector3();
  const mobile = () => canvas.clientWidth < 600;

  const resize = () => {
    // Size to the canvas, never to its parent (which also contains text on phones).
    const w = canvas.clientWidth || 800;
    const h = canvas.clientHeight || 640;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = mobile() ? 74 : 65;
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  resize();
  const onDown = (event: PointerEvent) => {
    dragging = true;
    dragX = event.clientX;
    dragY = event.clientY;
    startYaw = targetYaw;
    startPitch = targetPitch;
    canvas.setPointerCapture(event.pointerId);
  };
  const onMove = (event: PointerEvent) => {
    if (!dragging) return;
    targetYaw = startYaw - (event.clientX - dragX) * 0.003;
    targetPitch = THREE.MathUtils.clamp(
      startPitch + (event.clientY - dragY) * 0.002,
      -0.25,
      0.25,
    );
  };
  const onUp = () => {
    dragging = false;
  };
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);

  let visible = true;
  const io = new IntersectionObserver((entries) => {
    visible = entries.some((entry) => entry.isIntersecting);
  });
  io.observe(canvas);
  const animate = (now: number) => {
    const dt = Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;
    if (!visible || document.hidden || disposed) return;
    elapsed += dt;
    yaw = THREE.MathUtils.damp(yaw, targetYaw, 5, dt);
    pitch = THREE.MathUtils.damp(pitch, targetPitch, 5, dt);
    push = THREE.MathUtils.damp(push, pushTarget, 1.8, dt);
    const drift = opts.reducedMotion ? 0 : Math.sin(elapsed * 0.16) * 0.035;
    camera.position.set(0.05 + push * 0.06, 0, push * -0.28);
    direction.set(Math.sin(yaw + drift), pitch - 0.035, -Math.cos(yaw + drift));
    camera.lookAt(camera.position.clone().add(direction));
    try {
      renderer.getDrawingBufferSize(viewport);
      world?.update(camera, viewport);
      renderer.render(scene, camera);
      if (loaded && !presented) {
        presented = true;
        opts.onStatus?.("ready");
      }
    } catch (error) {
      renderer.setAnimationLoop(null);
      opts.onStatus?.("fallback");
      console.warn("Splat renderer stopped", error);
    }
  };
  renderer.setAnimationLoop(animate);

  return {
    pour() {
      canvas.parentElement?.classList.add("coffee-poured");
    },
    celebrate() {
      if (!opts.reducedMotion) pushTarget = 1;
    },
    dispose() {
      disposed = true;
      window.clearTimeout(fallbackTimer);
      renderer.setAnimationLoop(null);
      ro.disconnect();
      io.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      world?.dispose();
      renderer.dispose();
    },
  };
}
