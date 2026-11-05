import { vi } from "vitest";
import type { Env, KV } from "../src/env";

export class MemoryKV implements KV {
  readonly data = new Map<string, string>();
  async get(key: string) {
    return this.data.get(key) ?? null;
  }
  async put(key: string, value: string) {
    this.data.set(key, value);
  }
  async delete(key: string) {
    this.data.delete(key);
  }
}

export function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    COFFEE_KV: new MemoryKV(),
    PUBLIC_URL: "https://coffee.openworklabs.com",
    CITY: "sf",
    TIMEZONE: "America/Los_Angeles",
    HOST_NAME: "the OpenWork team",
    COFFEE_PLACE: "OpenWork · 700 Alabama St, San Francisco",
    COFFEE_PLACE_URL: "https://maps.google.com/?q=700+Alabama+St+San+Francisco",
    RESEND_API_KEY: "re_test",
    EMAIL_FROM: "OpenWork Coffee <coffee@openworklabs.com>",
    DEV_MODE: "1",
    ...overrides,
  };
}

export interface Captured {
  url: string;
  body: unknown;
  headers: Record<string, string>;
}

/** Stubs global fetch (Resend + Slack) and records outgoing calls. */
export function captureFetch(): Captured[] {
  const calls: Captured[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const headers = Object.fromEntries(new Headers(init?.headers).entries());
      calls.push({ url, headers, body: typeof init?.body === "string" ? JSON.parse(init.body) : null });
      if (url.includes("slack.com/api")) return Response.json({ ok: true });
      return Response.json({ id: "email_123" });
    }),
  );
  return calls;
}

/** A Tuesday morning in SF. */
export const TUESDAY_9AM_PT = new Date("2026-11-03T17:00:00Z");
