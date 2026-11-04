import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/worker";
import { VIEW_URI } from "../src/mcp";
import { captureFetch, makeEnv } from "./helpers";

beforeEach(() => {
  captureFetch();
});
afterEach(() => vi.unstubAllGlobals());

const BASE = "https://coffee.openworklabs.com/sf";

let id = 0;
async function rpc(env: ReturnType<typeof makeEnv>, method: string, params: Record<string, unknown> = {}) {
  const res = await worker.fetch(
    new Request(BASE, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
    }),
    env,
  );
  expect(res.status).toBe(200);
  const text = await res.text();
  // Responses may arrive as plain JSON or as one SSE "data:" frame.
  const payload = text.trim().startsWith("{") ? text : (text.split("\n").find((l) => l.startsWith("data:")) ?? "").slice(5);
  return JSON.parse(payload);
}

const INIT = {
  protocolVersion: "2025-06-18",
  capabilities: { extensions: { "io.modelcontextprotocol/ui": { mimeTypes: ["text/html;profile=mcp-app"] } } },
  clientInfo: { name: "test", version: "1" },
};

describe("MCP over HTTP at /sf", () => {
  it("initializes and lists both tools linked to the 3D view", async () => {
    const env = makeEnv();
    const init = await rpc(env, "initialize", INIT);
    expect(init.result.serverInfo.name).toBe("coffee-sf");

    const tools = await rpc(env, "tools/list");
    const names = tools.result.tools.map((t: { name: string }) => t.name).sort();
    expect(names).toEqual(["coffee_status", "grab_coffee"]);
    const grab = tools.result.tools.find((t: { name: string }) => t.name === "grab_coffee");
    expect(grab._meta.ui.resourceUri).toBe(VIEW_URI);
  });

  it("serves the MCP App resource as a single HTML file", async () => {
    const env = makeEnv();
    const read = await rpc(env, "resources/read", { uri: VIEW_URI });
    const content = read.result.contents[0];
    expect(content.mimeType).toBe("text/html;profile=mcp-app");
    expect(content.text).toContain("Put your email address");
    expect(content.text).not.toMatch(/<script[^>]+src=/); // everything inlined
  });

  it("grab_coffee without an email shows the card", async () => {
    const call = await rpc(makeEnv(), "tools/call", { name: "grab_coffee", arguments: {} });
    expect(call.result.structuredContent).toEqual({ state: "ask_email" });
  });

  it("grab_coffee with an email sends the confirmation", async () => {
    const call = await rpc(makeEnv(), "tools/call", { name: "grab_coffee", arguments: { email: "ada@example.com" } });
    expect(call.result.structuredContent).toMatchObject({ state: "check_inbox", email: "ada@example.com" });
    expect(call.result.content[0].text).toContain("requestId");
  });
});

describe("web routes", () => {
  it("serves the landing page to browsers on the same URL", async () => {
    const res = await worker.fetch(new Request(BASE, { headers: { accept: "text/html" } }), makeEnv());
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain("Grab a coffee in San");
  });

  it("redirects / to /sf", async () => {
    const res = await worker.fetch(new Request("https://coffee.openworklabs.com/"), makeEnv());
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(BASE);
  });

  it("books end to end: form -> confirm page -> POST confirm", async () => {
    const env = makeEnv();
    const res = await worker.fetch(
      new Request(`${BASE}/api/coffee`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "ada@example.com" }),
      }),
      env,
    );
    const body: { devConfirmUrl: string } = await res.json();
    const token = new URL(body.devConfirmUrl).searchParams.get("token") ?? "";

    const getPage = await worker.fetch(new Request(body.devConfirmUrl), env);
    expect(await getPage.text()).toContain("Confirm my coffee"); // GET never books

    const confirm = await worker.fetch(
      new Request(`${BASE}/confirm`, { method: "POST", body: new URLSearchParams({ token }) }),
      env,
    );
    expect(confirm.status).toBe(200);
    expect(await confirm.text()).toContain("You're on for coffee");
  });

  it("answers CORS preflight for browser MCP clients", async () => {
    const res = await worker.fetch(new Request(BASE, { method: "OPTIONS" }), makeEnv());
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-headers")).toContain("mcp-protocol-version");
  });
});
