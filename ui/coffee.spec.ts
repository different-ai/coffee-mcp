import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from "@playwright/test";

// A small MCP Apps host implementing the standard ui/initialize / tool-result
// exchange. Uses the same restrictive CSP as OpenWork (no eval or WASM permission).
const CSP = [
  "default-src 'none'",
  "script-src 'self' 'unsafe-inline' https://cdn.marble.worldlabs.ai blob:",
  "style-src 'self' 'unsafe-inline'",
  "connect-src https://cdn.marble.worldlabs.ai",
  "img-src 'self' data: blob: https://cdn.marble.worldlabs.ai",
  "worker-src 'self' blob:",
  "form-action 'none'",
].join("; ");

async function rpc(
  request: APIRequestContext,
  method: string,
  params: Record<string, unknown>,
) {
  const res = await request.post("/sf", {
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    data: { jsonrpc: "2.0", id: 1, method, params },
  });
  expect(res.ok()).toBeTruthy();
  const text = await res.text();
  const payload = text.startsWith("{")
    ? text
    : text
        .split("\n")
        .find((line) => line.startsWith("data:"))
        ?.slice(5);
  if (!payload) throw new Error("No MCP response");
  return JSON.parse(payload).result;
}

async function host(page: Page, request: APIRequestContext, result: unknown) {
  const appHtml = await (
    await request.get("/sf", { headers: { accept: "text/html" } })
  ).text();
  await page.route("**/test-view", (route) =>
    route.fulfill({
      contentType: "text/html",
      headers: { "content-security-policy": CSP },
      body: appHtml,
    }),
  );
  await page.route("**/test-host", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `
    <meta charset="utf-8"><style>body{margin:0}iframe{border:0;width:100%;height:900px}</style>
    <iframe src="/test-view"></iframe>
    <script>
      window.addEventListener('message', event => {
        const message = event.data;
        if (message.method === 'ui/initialize') {
          event.source.postMessage({jsonrpc:'2.0',id:message.id,result:{
            protocolVersion:message.params.protocolVersion,
            hostInfo:{name:'Coffee browser tests',version:'1'},
            hostCapabilities:{serverTools:{},openLinks:{}},
            hostContext:{theme:'light',displayMode:'inline'}
          }}, '*');
        }
        if (message.method === 'ui/notifications/initialized') {
          event.source.postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:${JSON.stringify(result)}}, '*');
        }
      });
    </script>`,
    }),
  );
  await page.goto("/test-host");
  return page.frameLocator("iframe");
}

test("the top-down neighborhood map renders under MCP Apps CSP; empty call needs no interaction", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const result = await rpc(request, "tools/call", {
    name: "grab_coffee",
    arguments: {},
  });
  expect(result.structuredContent.state).toBe("ask_email");
  const frame = await host(page, request, result);
  await expect(frame.locator("#email")).toHaveValue("");
  await expect(frame.locator("#card")).not.toHaveClass(/done/);
  await expect(frame.locator("#stage")).toHaveClass(/scene-ready/, {
    timeout: 40000,
  });
  await expect(frame.locator("#scene svg")).toBeVisible();
  await expect(frame.locator("#scene")).not.toContainText("700 Alabama");
  await expect(frame.locator("#scene-status")).toContainText(
    "Mission District · Drag to explore",
  );
  expect(errors).toEqual([]);
  await page.screenshot({ path: "docs/mcp-empty.png" });
});

test("email supplied by the agent books directly and hydrates the filled receipt without clicks", async ({
  page,
  request,
}) => {
  const result = await rpc(request, "tools/call", {
    name: "grab_coffee",
    arguments: { email: `browser-test-${Date.now()}@example.com` },
  });
  expect(result.structuredContent.state).toBe("booked");
  expect(JSON.stringify(result)).not.toContain("700 Alabama");
  const frame = await host(page, request, result);
  await expect(frame.locator("#receipt")).toBeVisible();
  await expect(frame.locator("#email")).toHaveValue(
    result.structuredContent.email,
  );
  await expect(frame.locator("#receipt")).toContainText(
    result.structuredContent.when,
  );
  await expect(frame.locator("#receipt")).not.toContainText("700 Alabama");
  await expect(frame.locator("#receipt")).toContainText(
    "Address in your email.",
  );
  await expect(frame.locator("#receipt")).not.toContainText("Tap the link");
  await expect(frame.locator("#stage")).toHaveClass(/scene-ready/, {
    timeout: 40000,
  });
  await page.screenshot({ path: "docs/mcp-booked.png" });
});

test("uses the real OpenWork logo, app branding and office invitation", async ({
  page,
  request,
}) => {
  const result = await rpc(request, "tools/call", {
    name: "grab_coffee",
    arguments: {},
  });
  const frame = await host(page, request, result);
  await expect(frame.locator(".wordmark")).toHaveText("OpenWork");
  await expect(frame.locator(".brand-logo")).toBeVisible();
  expect(
    await frame
      .locator(".brand-logo")
      .evaluate(
        (image: HTMLImageElement) => image.complete && image.naturalWidth > 0,
      ),
  ).toBeTruthy();
  await expect(frame.locator(".brand-logo")).toHaveCSS("width", "20px");
  await expect(frame.locator("#submit")).toHaveCSS(
    "background-color",
    "rgb(1, 22, 39)",
  );
  await expect(frame.locator(".invitation")).toHaveText(
    "Visit us at our office and get a free cup of some of the best coffee in SF.",
  );
  await expect(frame.locator("#stage")).toHaveClass(/scene-ready/);
  await expect(frame.locator("#install")).toBeHidden();
  await page.screenshot({ path: "docs/app.png" });
});

test("mobile MCP invitation stays readable without horizontal overflow", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 390, height: 1000 });
  const result = await rpc(request, "tools/call", {
    name: "grab_coffee",
    arguments: {},
  });
  const frame = await host(page, request, result);
  await expect(frame.locator("#stage")).toHaveClass(/scene-ready/);
  await expect(frame.locator("#email")).toBeVisible();
  await expect(frame.locator("#submit")).toBeVisible();
  expect(
    await frame
      .locator("body")
      .evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
  await page.screenshot({ path: "docs/mobile.png" });
});

test("the public website shows only install instructions, not the MCP map or form", async ({
  page,
}) => {
  await page.goto("/sf");
  await expect(page.locator("#install")).toBeVisible();
  await expect(page.locator("details")).toHaveAttribute("open", "");
  await expect(page.locator("#stage")).toBeHidden();
  await expect(page.locator("#email")).toBeHidden();
  await expect(page.locator("#scene svg")).toHaveCount(0);
  await expect(page.locator("#mcp-url")).toContainText("/sf");
  await expect(page.locator(".snippet pre")).toContainText(
    "claude mcp add --transport http coffee",
  );
  for (const name of [
    "Claude Code",
    "Cursor",
    "Codex",
    "VS Code",
    "OpenWork",
    "Claude.ai / ChatGPT",
  ]) {
    await expect(page.getByRole("tab", { name, exact: true })).toBeVisible();
  }
  await page.screenshot({ path: "docs/idle.png" });
  await page.setViewportSize({ width: 390, height: 850 });
  await expect(page.locator("#stage")).toBeHidden();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({ path: "docs/install-mobile.png" });
});

test("a failed invite is shown honestly, with calendar links still available", async ({
  page,
  request,
}) => {
  const frame = await host(page, request, {
    content: [],
    structuredContent: {
      state: "booked",
      email: "ada@example.com",
      requestId: "test",
      start: "2026-11-05T18:00:00Z",
      end: "2026-11-05T18:30:00Z",
      when: "Thursday, Nov 5 · 10:00 AM PST",
      place: "San Francisco · Address in your email.",
      inviteDelivery: "failed",
      calendarUrl: "https://coffee.openworklabs.com/sf/ics?id=test",
      googleCalendarUrl: "https://calendar.google.com",
    },
  });
  await expect(frame.locator("#receipt")).toContainText("email sending failed");
  await expect(
    frame.getByRole("button", { name: "Add to calendar", exact: true }),
  ).toBeVisible();
});
