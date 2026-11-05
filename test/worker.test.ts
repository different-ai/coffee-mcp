import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/worker";
import { VIEW_URI, LEGACY_VIEW_URI, VIEW_BUILD } from "../src/mcp";
import { createHash } from "node:crypto";
import { captureFetch, makeEnv } from "./helpers";

beforeEach(() => {
  captureFetch();
});
afterEach(() => vi.unstubAllGlobals());

const BASE = "https://coffee.openworklabs.com/sf";

let id = 0;
async function rpc(
  env: ReturnType<typeof makeEnv>,
  method: string,
  params: Record<string, unknown> = {},
) {
  const res = await worker.fetch(
    new Request(BASE, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
    }),
    env,
  );
  expect(res.status).toBe(200);
  const text = await res.text();
  // Responses may arrive as plain JSON or as one SSE "data:" frame.
  const payload = text.trim().startsWith("{")
    ? text
    : (text.split("\n").find((l) => l.startsWith("data:")) ?? "").slice(5);
  return JSON.parse(payload);
}

const INIT = {
  protocolVersion: "2025-06-18",
  capabilities: {
    extensions: {
      "io.modelcontextprotocol/ui": {
        mimeTypes: ["text/html;profile=mcp-app"],
      },
    },
  },
  clientInfo: { name: "test", version: "1" },
};

describe("MCP over HTTP at /sf", () => {
  it("initializes and lists both tools linked to the 3D view", async () => {
    const env = makeEnv();
    const init = await rpc(env, "initialize", INIT);
    expect(init.result.serverInfo.name).toBe("coffee-sf");

    const tools = await rpc(env, "tools/list");
    const names = tools.result.tools
      .map((t: { name: string }) => t.name)
      .sort();
    expect(names).toEqual(["coffee_status", "grab_coffee"]);
    const grab = tools.result.tools.find(
      (t: { name: string }) => t.name === "grab_coffee",
    );
    expect(grab._meta.ui.resourceUri).toBe(VIEW_URI);
  });

  it("gives each HTML build a content-addressed resource URI", async () => {
    const view = await rpc(makeEnv(), "resources/read", { uri: VIEW_URI });
    const html = view.result.contents[0].text;
    const hash = createHash("sha256").update(html).digest("hex").slice(0, 16);
    expect(VIEW_BUILD).toBe(hash);
    expect(VIEW_URI).toBe(`ui://coffee/sf-${hash}.html`);
    const changedHash = createHash("sha256")
      .update(`${html}\n<!-- new build -->`)
      .digest("hex")
      .slice(0, 16);
    expect(changedHash).not.toBe(hash);
    expect(html).toContain("Top-down map of the Mission District");
  });

  it("keeps the old resource URI readable but serves the current map", async () => {
    const view = await rpc(makeEnv(), "resources/read", {
      uri: LEGACY_VIEW_URI,
    });
    expect(view.result.contents[0].uri).toBe(LEGACY_VIEW_URI);
    expect(view.result.contents[0].text).toContain(
      "Top-down map of the Mission District",
    );
  });

  it("serves the MCP App resource as a single HTML file", async () => {
    const env = makeEnv();
    const read = await rpc(env, "resources/read", { uri: VIEW_URI });
    const content = read.result.contents[0];
    expect(content.mimeType).toBe("text/html;profile=mcp-app");
    expect(content._meta.ui.csp.connectDomains).toEqual([]);
    expect(content._meta.ui.csp.resourceDomains).toEqual([]);
    expect(content.text).toContain("Put your email address");
    expect(content.text).not.toMatch(/<script[^>]+src=/); // everything inlined
  });

  it("grab_coffee without an email shows an empty card without side effects", async () => {
    const sent = vi.fn(async () => ({ messageId: "m1" }));
    const env = makeEnv({ EMAIL: { send: sent } });
    const put = vi.spyOn(env.COFFEE_KV, "put");
    const call = await rpc(env, "tools/call", {
      name: "grab_coffee",
      arguments: {},
    });
    expect(call.result.structuredContent).toEqual({ state: "ask_email" });
    expect(sent).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
    expect(call.result.content[0].text).toContain(
      "Ask the user for their email",
    );
  });

  it("grab_coffee with an email books immediately and sends one invite, including on repeat calls", async () => {
    const sent = vi.fn(
      async (
        _message: Parameters<
          NonNullable<ReturnType<typeof makeEnv>["EMAIL"]>["send"]
        >[0],
      ) => ({ messageId: "m1" }),
    );
    const env = makeEnv({ EMAIL: { send: sent } });
    const call = await rpc(env, "tools/call", {
      name: "grab_coffee",
      arguments: { email: "ada@example.com" },
    });
    expect(call.result.structuredContent).toMatchObject({
      state: "booked",
      email: "ada@example.com",
      inviteDelivery: "sent",
      place: "San Francisco · Address in your email.",
    });
    expect(call.result.content[0].text).toContain(
      "No confirmation click is needed",
    );
    const repeated = await rpc(env, "tools/call", {
      name: "grab_coffee",
      arguments: { email: "ada@example.com" },
    });
    expect(repeated.result.structuredContent).toEqual(
      call.result.structuredContent,
    );
    expect(sent).toHaveBeenCalledTimes(1);
    expect(sent.mock.calls[0]?.[0]).toMatchObject({
      attachments: [expect.objectContaining({ filename: "coffee.ics" })],
    });
    const status = await rpc(env, "tools/call", {
      name: "coffee_status",
      arguments: { requestId: call.result.structuredContent.requestId },
    });
    expect(status.result.structuredContent).toEqual(
      call.result.structuredContent,
    );
  });

  it("rejects invalid email without sending anything", async () => {
    const sent = vi.fn(
      async (
        _message: Parameters<
          NonNullable<ReturnType<typeof makeEnv>["EMAIL"]>["send"]
        >[0],
      ) => ({ messageId: "m1" }),
    );
    const call = await rpc(makeEnv({ EMAIL: { send: sent } }), "tools/call", {
      name: "grab_coffee",
      arguments: { email: "not-an-email" },
    });
    expect(call.result.isError).toBe(true);
    expect(call.result.structuredContent).toMatchObject({
      state: "error",
      code: "invalid_email",
    });
    expect(sent).not.toHaveBeenCalled();
  });

  it("reports invite failure while keeping the reservation, without falsely claiming it was sent", async () => {
    const env = makeEnv({
      EMAIL: {
        send: async () => {
          throw new Error("delivery unavailable");
        },
      },
    });
    const call = await rpc(env, "tools/call", {
      name: "grab_coffee",
      arguments: { email: "ada@example.com" },
    });
    expect(call.result.structuredContent).toMatchObject({
      state: "booked",
      inviteDelivery: "failed",
    });
    expect(call.result.content[0].text).toContain("invite could not be sent");
    expect(call.result.content[0].text).not.toContain("provider accepted");
    const status = await rpc(env, "tools/call", {
      name: "coffee_status",
      arguments: { requestId: call.result.structuredContent.requestId },
    });
    expect(status.result.structuredContent).toEqual(
      call.result.structuredContent,
    );
  });
});

describe("web routes", () => {
  it("serves the landing page to browsers on the same URL", async () => {
    const res = await worker.fetch(
      new Request(BASE, { headers: { accept: "text/html" } }),
      makeEnv(),
    );
    expect(res.headers.get("content-type")).toContain("text/html");
    const page = await res.text();
    expect(page).toContain("Coffee at OpenWork");
    expect(page).not.toContain("700 Alabama St");
    expect(page).toContain("Address in your email.");
    expect(page.replace(/\s+/g, " ")).toContain("Visit us at our office and get a free cup of some of the best coffee in SF.");
    expect(page).toContain("brand-logo");
  });

  it("redirects / to /sf", async () => {
    const res = await worker.fetch(
      new Request("https://coffee.openworklabs.com/"),
      makeEnv(),
    );
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
      new Request(`${BASE}/confirm`, {
        method: "POST",
        body: new URLSearchParams({ token }),
      }),
      env,
    );
    expect(confirm.status).toBe(200);
    expect(await confirm.text()).toContain("You're on for coffee");
  });

  it("answers CORS preflight for browser MCP clients", async () => {
    const res = await worker.fetch(
      new Request(BASE, { method: "OPTIONS" }),
      makeEnv(),
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-headers")).toContain(
      "mcp-protocol-version",
    );
  });
});
