import { App } from "@modelcontextprotocol/ext-apps";
import { isCoffeeResult, type CoffeeResult } from "../src/shared";
import { renderInstall } from "./install";
import { createScene } from "./scene";

const $ = <T extends HTMLElement>(sel: string): T => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`missing ${sel}`);
  return el;
};

const form = $<HTMLFormElement>("#form");
const input = $<HTMLInputElement>("#email");
const submit = $<HTMLButtonElement>("#submit");
const errorEl = $<HTMLParagraphElement>("#error");
const card = $<HTMLDivElement>("#card");
const receipt = $<HTMLElement>("#receipt");
const receiptBody = $<HTMLDivElement>("#receipt-body");
const receiptFooter = $<HTMLElement>("#receipt-footer");

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const scene = createScene($<HTMLCanvasElement>("#scene"), { reducedMotion });

/** Inside an MCP host we live in an iframe; on coffee.openworklabs.com we're the page. */
const standalone = window.self === window.top;

interface Backend {
  request(email: string): Promise<CoffeeResult>;
  status(requestId: string): Promise<CoffeeResult>;
  open(url: string): void;
}

function toResult(value: unknown): CoffeeResult {
  return isCoffeeResult(value) ? value : { state: "error", code: "internal", message: "Unexpected response." };
}

function webBackend(): Backend {
  const base = location.pathname.replace(/\/+$/, "");
  return {
    async request(email) {
      const res = await fetch(`${base}/api/coffee`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      return toResult(await res.json());
    },
    async status(requestId) {
      const res = await fetch(`${base}/api/status?id=${encodeURIComponent(requestId)}`);
      return toResult(await res.json());
    },
    open(url) {
      window.open(url, "_blank", "noopener");
    },
  };
}

function mcpBackend(app: App): Backend {
  return {
    async request(email) {
      const res = await app.callServerTool({ name: "grab_coffee", arguments: { email } });
      return toResult(res.structuredContent);
    },
    async status(requestId) {
      const res = await app.callServerTool({ name: "coffee_status", arguments: { requestId } });
      return toResult(res.structuredContent);
    },
    open(url) {
      void app.openLink({ url });
    },
  };
}

let backend: Backend = webBackend();
let pollTimer: number | undefined;

function row(label: string, value: string): HTMLDivElement {
  const div = document.createElement("div");
  div.className = "row";
  const a = document.createElement("span");
  a.textContent = label;
  const b = document.createElement("span");
  b.textContent = value;
  div.append(a, b);
  return div;
}

function line(text: string, className?: string): HTMLParagraphElement {
  const p = document.createElement("p");
  p.style.margin = "4px 0";
  p.textContent = text;
  if (className) p.className = className;
  return p;
}

function linkButton(label: string, url: string, ghost = false): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = label;
  if (ghost) b.className = "ghost";
  b.addEventListener("click", () => backend.open(url));
  return b;
}

function showReceipt(): void {
  card.classList.add("done");
  if (receipt.hidden) {
    receipt.hidden = false;
    receipt.classList.remove("printing");
    void receipt.offsetWidth;
    receipt.classList.add("printing");
  }
}

function render(result: CoffeeResult): void {
  errorEl.hidden = true;
  switch (result.state) {
    case "ask_email": {
      if (result.email) input.value = result.email;
      return;
    }
    case "error": {
      submit.disabled = false;
      submit.textContent = "Grab a coffee";
      errorEl.textContent = result.message;
      errorEl.hidden = false;
      return;
    }
    case "check_inbox": {
      scene?.pour();
      showReceipt();
      receiptBody.replaceChildren(
        row("FOR", result.email),
        row("ORDER", "1 × coffee, SF"),
        line("Check your inbox", "big"),
        line("Tap the link we sent and we'll pick a time", "muted dots"),
      );
      receiptFooter.replaceChildren();
      if (result.devConfirmUrl) receiptFooter.append(linkButton("Dev: confirm link", result.devConfirmUrl, true));
      startPolling(result.requestId);
      return;
    }
    case "booked": {
      stopPolling();
      scene?.pour();
      scene?.celebrate();
      showReceipt();
      receiptBody.replaceChildren(
        row("FOR", result.email),
        line("You're on for coffee ☕", "big"),
        row("WHEN", result.when),
        row("WHERE", result.place),
      );
      receiptFooter.replaceChildren(
        linkButton("Add to calendar", result.googleCalendarUrl),
        linkButton(".ics", result.calendarUrl, true),
      );
      if (result.placeUrl) receiptFooter.append(linkButton("Map", result.placeUrl, true));
      return;
    }
  }
}

function stopPolling(): void {
  if (pollTimer !== undefined) window.clearInterval(pollTimer);
  pollTimer = undefined;
}

/** After the email is confirmed, the receipt flips to the booked time on its own. */
function startPolling(requestId: string): void {
  stopPolling();
  const startedAt = Date.now();
  pollTimer = window.setInterval(async () => {
    if (Date.now() - startedAt > 15 * 60_000) return stopPolling();
    try {
      const result = await backend.status(requestId);
      if (result.state === "booked") render(result);
    } catch {
      // keep waiting
    }
  }, 4000);
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = input.value.trim();
  if (!email || !input.checkValidity()) {
    render({ state: "error", code: "invalid_email", message: "Put your email address first." });
    input.focus();
    return;
  }
  submit.disabled = true;
  submit.textContent = "Brewing…";
  try {
    render(await backend.request(email));
  } catch {
    render({ state: "error", code: "internal", message: "Couldn't reach the coffee machine. Try again." });
  }
});

async function connectToHost(): Promise<void> {
  const app = new App({ name: "coffee-sf", version: "0.1.0" }, {});
  app.ontoolinput = (params) => {
    const email = params.arguments?.email;
    if (typeof email === "string") input.value = email;
  };
  app.ontoolresult = (params) => {
    if (isCoffeeResult(params.structuredContent)) render(params.structuredContent);
  };
  await app.connect();
  backend = mcpBackend(app);
}

if (standalone) {
  document.body.classList.add("standalone");
  renderInstall($<HTMLElement>("#install"), `${location.origin}${location.pathname.replace(/\/+$/, "")}`);
} else {
  connectToHost().catch((err: unknown) => console.warn("MCP host connection failed", err));
}
