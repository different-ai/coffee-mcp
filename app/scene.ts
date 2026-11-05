import neighborhood from "./neighborhood.svg?raw";

export interface CoffeeScene {
  pour(): void;
  celebrate(): void;
  dispose(): void;
}

/** Bundled OSM neighborhood map. No location pin, API key, tile requests or WebGL. */
export function createScene(
  container: HTMLDivElement,
  opts: {
    reducedMotion: boolean;
    onStatus?: (status: "loading" | "ready" | "fallback") => void;
  },
): CoffeeScene {
  container.innerHTML = neighborhood;
  const svg = container.querySelector("svg");
  if (svg) {
    svg.setAttribute("preserveAspectRatio", "xMidYMid slice");
    svg.setAttribute("aria-hidden", "true");
  }
  let x = 0;
  let y = 0;
  let downX = 0;
  let downY = 0;
  let startX = 0;
  let startY = 0;
  let dragging = false;
  const draw = () => {
    if (svg) svg.style.transform = `translate(${x}px, ${y}px) scale(1.35)`;
  };
  const onDown = (event: PointerEvent) => {
    dragging = true;
    downX = event.clientX;
    downY = event.clientY;
    startX = x;
    startY = y;
    container.setPointerCapture(event.pointerId);
  };
  const onMove = (event: PointerEvent) => {
    if (!dragging) return;
    const maxX = container.clientWidth * 0.15;
    const maxY = container.clientHeight * 0.15;
    x = Math.max(-maxX, Math.min(maxX, startX + event.clientX - downX));
    y = Math.max(-maxY, Math.min(maxY, startY + event.clientY - downY));
    draw();
  };
  const onUp = () => {
    dragging = false;
  };
  container.addEventListener("pointerdown", onDown);
  container.addEventListener("pointermove", onMove);
  container.addEventListener("pointerup", onUp);
  container.addEventListener("pointercancel", onUp);
  draw();
  const ready = requestAnimationFrame(() => opts.onStatus?.("ready"));
  return {
    pour() {},
    celebrate() {},
    dispose() {
      cancelAnimationFrame(ready);
      container.removeEventListener("pointerdown", onDown);
      container.removeEventListener("pointermove", onMove);
      container.removeEventListener("pointerup", onUp);
      container.removeEventListener("pointercancel", onUp);
      container.replaceChildren();
    },
  };
}
