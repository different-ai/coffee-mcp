import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { coffeeIcs, coffeeStatus, confirmCoffee, LIMITS, requestCoffee } from "../src/coffee";
import { bookingMessage } from "../src/slack";
import { captureFetch, makeEnv, TUESDAY_9AM_PT, type Captured } from "./helpers";

let calls: Captured[];
beforeEach(() => {
  calls = captureFetch();
});
afterEach(() => vi.unstubAllGlobals());

function tokenFrom(url: string | undefined): string {
  return new URL(url ?? "").searchParams.get("token") ?? "";
}

describe("requestCoffee", () => {
  it("rejects things that aren't emails", async () => {
    const result = await requestCoffee(makeEnv(), { email: "not-an-email", source: "web" });
    expect(result).toMatchObject({ state: "error", code: "invalid_email" });
  });

  it("asks the person to check their inbox and emails a confirm link", async () => {
    const env = makeEnv({ RESEND_API_KEY: "re_test" });
    const result = await requestCoffee(env, { email: "  Ada@Example.com ", source: "web" }, TUESDAY_9AM_PT);
    expect(result).toMatchObject({ state: "check_inbox", email: "ada@example.com" });
    expect(result.state === "check_inbox" && result.devConfirmUrl).toMatch(
      /^https:\/\/coffee\.openworklabs\.com\/sf\/confirm\?token=[0-9a-f]{48}$/,
    );
    const resend = calls.find((c) => c.url === "https://api.resend.com/emails");
    expect(resend?.body).toMatchObject({ to: ["ada@example.com"], subject: "Confirm your coffee in SF ☕" });
  });

  it("books directly for MCP, preserving the normalized email, note and delivery state", async () => {
    const env = makeEnv({ SLACK_WEBHOOK_URL: "https://hooks.slack.com/x" });
    const result = await requestCoffee(env, { email: "  Ada@Example.com ", note: "agents + coffee", source: "mcp" }, TUESDAY_9AM_PT);
    expect(result).toMatchObject({
      state: "booked", email: "ada@example.com", inviteDelivery: "sent",
      start: "2026-11-04T18:00:00.000Z", place: "OpenWork · 700 Alabama St, San Francisco",
    });
    const emails = calls.filter((call) => call.url === "https://api.resend.com/emails");
    expect(emails).toHaveLength(1);
    expect(emails[0]?.body).toMatchObject({ to: ["ada@example.com"], attachments: [expect.objectContaining({ filename: "coffee.ics" })] });
    expect(JSON.stringify(calls.find((call) => call.url.includes("hooks.slack.com"))?.body)).toContain("agents + coffee");
  });

  it("promotes an existing web request to a direct MCP booking without another confirmation", async () => {
    const env = makeEnv();
    const pending = await requestCoffee(env, { email: "ada@example.com", source: "web" }, TUESDAY_9AM_PT);
    const booked = await requestCoffee(env, { email: "ada@example.com", source: "mcp" }, TUESDAY_9AM_PT);
    if (pending.state !== "check_inbox" || booked.state !== "booked") throw new Error("expected pending then booked");
    expect(booked.requestId).toBe(pending.requestId);
    expect(calls.filter((call) => call.url === "https://api.resend.com/emails")).toHaveLength(2);
    expect((await confirmCoffee(env, tokenFrom(pending.devConfirmUrl), TUESDAY_9AM_PT)).result).toEqual(booked);
    expect(calls.filter((call) => call.url === "https://api.resend.com/emails")).toHaveLength(2);
  });

  it("keeps the IP limit for direct MCP bookings", async () => {
    const env = makeEnv();
    await env.COFFEE_KV.put("rl:ip:192.0.2.1", String(LIMITS.perIpPerHour));
    expect(await requestCoffee(env, { email: "ada@example.com", source: "mcp", ip: "192.0.2.1" })).toMatchObject({
      state: "error", code: "rate_limited",
    });
    expect(calls).toHaveLength(0);
  });

  it("does not leak the confirm link outside dev mode", async () => {
    const result = await requestCoffee(makeEnv({ DEV_MODE: undefined }), { email: "a@b.co", source: "web" });
    expect(result.state === "check_inbox" && result.devConfirmUrl).toBeUndefined();
  });

  it("rate limits repeated requests for one email", async () => {
    const env = makeEnv();
    for (let i = 0; i < LIMITS.perEmailPerDay; i++) {
      expect((await requestCoffee(env, { email: "a@b.co", source: "web" })).state).toBe("check_inbox");
    }
    expect(await requestCoffee(env, { email: "a@b.co", source: "web" })).toMatchObject({ code: "rate_limited" });
  });

  it("reuses the pending request instead of creating a new one", async () => {
    const env = makeEnv();
    const a = await requestCoffee(env, { email: "a@b.co", source: "web" });
    const b = await requestCoffee(env, { email: "a@b.co", source: "web" });
    expect(a.state === "check_inbox" && b.state === "check_inbox" && a.requestId === b.requestId).toBe(true);
  });
});

describe("confirmCoffee", () => {
  it("books a slot, sends the invite and posts to Slack", async () => {
    const env = makeEnv({ RESEND_API_KEY: "re_test", SLACK_BOT_TOKEN: "xoxb-test", SLACK_CHANNEL_ID: "C0CF2BGF1MF" });
    const req = await requestCoffee(env, { email: "ada@example.com", note: "agents + coffee", source: "web" }, TUESDAY_9AM_PT);
    const token = tokenFrom(req.state === "check_inbox" ? req.devConfirmUrl : undefined);

    const { result, slack } = await confirmCoffee(env, token, TUESDAY_9AM_PT);
    expect(result).toMatchObject({
      state: "booked",
      email: "ada@example.com",
      start: "2026-11-04T18:00:00.000Z",
      when: "Wednesday, Nov 4 · 10:00 AM PST",
      place: "OpenWork · 700 Alabama St, San Francisco",
    });
    expect(slack).toBe("sent");

    const slackCall = calls.find((c) => c.url === "https://slack.com/api/chat.postMessage");
    expect(slackCall?.headers.authorization).toBe("Bearer xoxb-test");
    expect(slackCall?.body).toMatchObject({ channel: "C0CF2BGF1MF", text: expect.stringContaining("ada@example.com") });

    const invite = calls.filter((c) => c.url === "https://api.resend.com/emails").at(-1);
    expect(invite?.body).toMatchObject({ subject: "Coffee with the OpenWork team: Wednesday, Nov 4 · 10:00 AM PST" });
    expect(JSON.stringify(invite?.body)).toContain("coffee.ics");
  });

  it("falls back to an incoming webhook", async () => {
    const env = makeEnv({ SLACK_WEBHOOK_URL: "https://hooks.slack.com/services/T/B/X" });
    const req = await requestCoffee(env, { email: "a@b.co", source: "web" }, TUESDAY_9AM_PT);
    const { slack } = await confirmCoffee(env, tokenFrom(req.state === "check_inbox" ? req.devConfirmUrl : undefined), TUESDAY_9AM_PT);
    expect(slack).toBe("sent");
    expect(calls.some((c) => c.url === "https://hooks.slack.com/services/T/B/X")).toBe(true);
  });

  it("gives two people two different slots", async () => {
    const env = makeEnv();
    const starts: string[] = [];
    for (const email of ["a@b.co", "c@d.co"]) {
      const req = await requestCoffee(env, { email, source: "web" }, TUESDAY_9AM_PT);
      const { result } = await confirmCoffee(env, tokenFrom(req.state === "check_inbox" ? req.devConfirmUrl : undefined), TUESDAY_9AM_PT);
      if (result.state === "booked") starts.push(result.start);
    }
    expect(new Set(starts).size).toBe(2);
  });

  it("is idempotent: confirming twice keeps the same slot and posts once", async () => {
    const env = makeEnv({ SLACK_WEBHOOK_URL: "https://hooks.slack.com/x" });
    const req = await requestCoffee(env, { email: "a@b.co", source: "web" }, TUESDAY_9AM_PT);
    const token = tokenFrom(req.state === "check_inbox" ? req.devConfirmUrl : undefined);
    const first = await confirmCoffee(env, token, TUESDAY_9AM_PT);
    const second = await confirmCoffee(env, token, TUESDAY_9AM_PT);
    expect(second.result).toEqual(first.result);
    expect(second.slack).toBe("not_sent");
    expect(calls.filter((c) => c.url.includes("hooks.slack.com"))).toHaveLength(1);
  });

  it("rejects unknown tokens", async () => {
    const { result } = await confirmCoffee(makeEnv(), "nope");
    expect(result).toMatchObject({ state: "error", code: "not_found" });
  });

  it("exposes status and an .ics once booked", async () => {
    const env = makeEnv();
    const req = await requestCoffee(env, { email: "a@b.co", source: "web" }, TUESDAY_9AM_PT);
    if (req.state !== "check_inbox") throw new Error("expected check_inbox");
    expect((await coffeeStatus(env, req.requestId)).state).toBe("check_inbox");
    await confirmCoffee(env, tokenFrom(req.devConfirmUrl), TUESDAY_9AM_PT);
    expect((await coffeeStatus(env, req.requestId)).state).toBe("booked");
    const ics = await coffeeIcs(env, req.requestId);
    expect(ics).toContain("DTSTART:20261104T180000Z");
    expect(ics).toContain("ATTENDEE;ROLE=REQ-PARTICIPANT;RSVP=TRUE:mailto:a@b.co");
  });
});

describe("email delivery", () => {
  it("prefers the Cloudflare Email Service binding and attaches the invite", async () => {
    const sent: Parameters<NonNullable<ReturnType<typeof makeEnv>["EMAIL"]>["send"]>[0][] = [];
    const env = makeEnv({
      RESEND_API_KEY: "re_should_not_be_used",
      HOST_EMAIL: "host@openworklabs.com",
      EMAIL: { send: async (m) => (sent.push(m), { messageId: "m1" }) },
    });
    const req = await requestCoffee(env, { email: "ada@example.com", source: "web" }, TUESDAY_9AM_PT);
    await confirmCoffee(env, tokenFrom(req.state === "check_inbox" ? req.devConfirmUrl : undefined), TUESDAY_9AM_PT);
    expect(sent.map((m) => m.subject)).toEqual([
      "Confirm your coffee in SF ☕",
      "Coffee with the OpenWork team: Wednesday, Nov 4 · 10:00 AM PST",
    ]);
    expect(sent[0]?.from).toEqual({ name: "OpenWork Coffee", email: "coffee@openworklabs.com" });
    expect(sent[1]?.cc).toBe("host@openworklabs.com");
    expect(sent[1]?.attachments?.[0]).toMatchObject({ filename: "coffee.ics", disposition: "attachment" });
    expect(calls.some((c) => c.url.includes("resend.com"))).toBe(false);
  });

  it("does not claim check_inbox when confirmation delivery throws", async () => {
    const env = makeEnv({ EMAIL: { send: async () => Promise.reject(new Error("E_SENDER_NOT_VERIFIED")) } });
    const result = await requestCoffee(env, { email: "a@b.co", source: "web" });
    expect(result).toMatchObject({ state: "error", code: "email_delivery_failed" });
    if (result.state !== "error" || !result.requestId) throw new Error("expected delivery failure with request id");
    expect(await coffeeStatus(env, result.requestId)).toEqual(result);
  });

  it("reports an unconfigured sender accurately for both flows", async () => {
    const env = makeEnv({ RESEND_API_KEY: undefined });
    expect(await requestCoffee(env, { email: "web@example.com", source: "web" })).toMatchObject({
      state: "error", code: "email_delivery_failed",
    });
    expect(await requestCoffee(env, { email: "mcp@example.com", source: "mcp" })).toMatchObject({
      state: "booked", inviteDelivery: "failed",
    });
  });
});

describe("slack message", () => {
  it("escapes user content", () => {
    const msg = bookingMessage({ email: "a@b.co", when: "Wed", place: "Cafe", note: "<!channel> & hi", source: "web", requestId: "r1" });
    expect(JSON.stringify(msg)).toContain("&lt;!channel&gt; &amp; hi");
  });
});
