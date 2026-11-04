import { createMcpHandler } from "@modelcontextprotocol/server";
import appHtml from "../dist/app.html";
import { coffeeIcs, coffeeStatus, confirmCoffee, requestCoffee } from "./coffee";
import { cityPath, type Env } from "./env";
import { buildServer } from "./mcp";
import type { CoffeeResult } from "./shared";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  "access-control-allow-headers": "content-type, authorization, accept, mcp-session-id, mcp-protocol-version, last-event-id",
  "access-control-expose-headers": "mcp-session-id, mcp-protocol-version",
};

function withCors(res: Response): Response {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(CORS)) out.headers.set(k, v);
  return out;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...CORS },
  });
}

function html(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}

function statusFor(result: CoffeeResult): number {
  if (result.state !== "error") return 200;
  return { invalid_email: 400, rate_limited: 429, not_found: 404, internal: 500 }[result.code];
}

function esc(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · OpenWork Coffee</title>
<style>
:root{color-scheme:dark}
body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
background:radial-gradient(120% 80% at 50% 110%,#f2a988 0%,#7d5a8c 45%,#1f2350 100%);color:#fff6ef}
.card{width:min(420px,calc(100vw - 48px));background:rgba(20,18,34,.55);backdrop-filter:blur(14px);border:1px solid rgba(255,255,255,.14);border-radius:20px;padding:28px}
.eyebrow{font-size:12px;letter-spacing:.08em;text-transform:uppercase;opacity:.7;margin:0 0 10px}
h1{font-size:24px;margin:0 0 12px} p{line-height:1.5}
dl{display:grid;grid-template-columns:auto 1fr;gap:6px 16px;margin:18px 0} dt{opacity:.65} dd{margin:0;font-weight:600}
.btn{display:inline-block;border:0;cursor:pointer;font:inherit;font-weight:600;padding:12px 20px;border-radius:999px;background:linear-gradient(135deg,#ffc89a,#f08a5d);color:#2a1410;text-decoration:none}
.btn.secondary{background:rgba(255,255,255,.12);color:#fff6ef;margin-left:8px}
a{color:#ffd2b0}
</style></head><body><main class="card"><p class="eyebrow">OpenWork Coffee · SF</p>${body}</main></body></html>`;
}

function confirmPage(token: string): string {
  return page(
    "Confirm your coffee",
    `<h1>One tap and the coffee's on.</h1><p>Confirm and we'll pick a time and send you an invite.</p>
<form method="post"><input type="hidden" name="token" value="${esc(token)}"><button class="btn" type="submit">Confirm my coffee</button></form>`,
  );
}

function resultPage(result: CoffeeResult, home: string): string {
  if (result.state === "booked") {
    const where = result.placeUrl ? `<a href="${esc(result.placeUrl)}">${esc(result.place)}</a>` : esc(result.place);
    return page(
      "You're on for coffee",
      `<h1>You're on for coffee ☕</h1><dl><dt>When</dt><dd>${esc(result.when)}</dd><dt>Where</dt><dd>${where}</dd></dl>
<p>We emailed the invite to ${esc(result.email)}.</p>
<a class="btn" href="${esc(result.googleCalendarUrl)}">Add to Google Calendar</a><a class="btn secondary" href="${esc(result.calendarUrl)}">.ics</a>`,
    );
  }
  const message = result.state === "error" ? result.message : "Something went sideways.";
  return page("Hmm", `<h1>Hmm.</h1><p>${esc(message)}</p><a class="btn" href="${esc(home)}">Back to coffee</a>`);
}

async function readBody(req: Request): Promise<Record<string, unknown>> {
  const type = req.headers.get("content-type") ?? "";
  if (type.includes("application/json")) {
    const value: unknown = await req.json().catch(() => null);
    return typeof value === "object" && value !== null ? Object.fromEntries(Object.entries(value)) : {};
  }
  const form = await req.formData().catch(() => null);
  return form ? Object.fromEntries(form.entries()) : {};
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const base = cityPath(env);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const ip = req.headers.get("cf-connecting-ip") ?? undefined;

    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (path === "/") return Response.redirect(`${url.origin}${base}`, 302);

    if (path === base || path === `${base}/mcp`) {
      const accept = req.headers.get("accept") ?? "";
      if (req.method === "GET" && accept.includes("text/html")) return html(appHtml);
      const handler = createMcpHandler(() => buildServer(env, { ip }));
      return withCors(await handler.fetch(req));
    }

    if (path === `${base}/api/coffee` && req.method === "POST") {
      const body = await readBody(req);
      const email = str(body.email);
      if (!email) return json({ state: "error", code: "invalid_email", message: "Put your email address first." }, 400);
      const result = await requestCoffee(env, { email, note: str(body.note), source: "web", ip });
      return json(result, statusFor(result));
    }

    if (path === `${base}/api/status` && req.method === "GET") {
      const id = url.searchParams.get("id");
      if (!id) return json({ state: "error", code: "not_found", message: "Missing id." }, 400);
      const result = await coffeeStatus(env, id);
      return json(result, statusFor(result));
    }

    if (path === `${base}/confirm`) {
      if (req.method === "GET") {
        // Show a button instead of confirming on GET, so link scanners can't book coffee.
        return html(confirmPage(url.searchParams.get("token") ?? ""));
      }
      if (req.method === "POST") {
        const token = str((await readBody(req)).token) ?? "";
        const { result } = await confirmCoffee(env, token);
        return html(resultPage(result, `${url.origin}${base}`), statusFor(result));
      }
    }

    if (path === `${base}/ics` && req.method === "GET") {
      const ics = await coffeeIcs(env, url.searchParams.get("id") ?? "");
      if (!ics) return new Response("Not found", { status: 404 });
      return new Response(ics, {
        headers: { "content-type": "text/calendar; charset=utf-8", "content-disposition": 'attachment; filename="coffee.ics"' },
      });
    }

    return new Response("Not found", { status: 404 });
  },
};
