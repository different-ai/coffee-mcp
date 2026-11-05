import { z } from "zod";
import { addressOf, buildIcs, googleCalendarUrl, type CalendarEvent } from "./calendar";
import { confirmationEmail, inviteEmail, sendEmail } from "./email";
import { publicBase, type Env, type KV } from "./env";
import { formatWhen, proposeSlot } from "./schedule";
import type { CoffeeResult } from "./shared";
import { notifySlack } from "./slack";

const DAY = 86_400;
const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]{2,}$/;

export const LIMITS = {
  perEmailPerDay: 3,
  perIpPerHour: 20,
};

const StoredRequestSchema = z.object({
  id: z.string(),
  email: z.string(),
  note: z.string().optional(),
  source: z.enum(["mcp", "web"]),
  status: z.enum(["pending", "booked"]),
  token: z.string(),
  createdAt: z.string(),
  start: z.string().optional(),
  end: z.string().optional(),
  confirmationDelivery: z.enum(["sent", "failed"]).optional(),
  inviteDelivery: z.enum(["sent", "failed", "unknown"]).optional(),
});
type StoredRequest = z.infer<typeof StoredRequestSchema>;

function parseRequest(raw: string | null): StoredRequest | null {
  if (!raw) return null;
  const parsed = StoredRequestSchema.safeParse(JSON.parse(raw));
  return parsed.success ? parsed.data : null;
}

async function loadRequest(kv: KV, id: string): Promise<StoredRequest | null> {
  return parseRequest(await kv.get(`req:${id}`));
}

async function saveRequest(kv: KV, req: StoredRequest): Promise<void> {
  await kv.put(`req:${req.id}`, JSON.stringify(req), { expirationTtl: 90 * DAY });
}

/** Fixed-window counter; KV is eventually consistent, which is fine for abuse damping. */
async function allow(kv: KV, key: string, limit: number, ttl: number): Promise<boolean> {
  const count = Number((await kv.get(key)) ?? "0");
  if (count >= limit) return false;
  await kv.put(key, String(count + 1), { expirationTtl: ttl });
  return true;
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return email.length <= 254 && EMAIL_RE.test(email);
}

function calendarEvent(env: Env, req: StoredRequest): CalendarEvent | null {
  if (!req.start || !req.end) return null;
  return {
    id: req.id,
    start: new Date(req.start),
    end: new Date(req.end),
    title: "Coffee with OpenWork",
    description: `Coffee with ${env.HOST_NAME} in San Francisco. Booked via coffee.openworklabs.com/sf.`,
    location: env.COFFEE_PLACE,
    organizerEmail: addressOf(env.EMAIL_FROM),
    attendeeEmail: req.email,
  };
}

function bookedResult(env: Env, req: StoredRequest): CoffeeResult {
  const event = calendarEvent(env, req);
  if (!event || !req.start || !req.end) return { state: "error", code: "internal", message: "Booking is missing a time." };
  return {
    state: "booked",
    email: req.email,
    requestId: req.id,
    start: req.start,
    end: req.end,
    when: formatWhen(event.start, env.TIMEZONE),
    place: env.COFFEE_PLACE,
    placeUrl: env.COFFEE_PLACE_URL,
    calendarUrl: `${publicBase(env)}/ics?id=${req.id}`,
    googleCalendarUrl: googleCalendarUrl(event),
    inviteDelivery: req.inviteDelivery ?? "unknown",
  };
}

function checkInbox(env: Env, req: StoredRequest): CoffeeResult {
  if (req.confirmationDelivery === "failed") {
    return {
      state: "error",
      code: "email_delivery_failed",
      message: "We couldn't send the confirmation email. No coffee has been booked. Try again later.",
      requestId: req.id,
    };
  }
  return {
    state: "check_inbox",
    email: req.email,
    requestId: req.id,
    devConfirmUrl: env.DEV_MODE === "1" ? confirmUrl(env, req.token) : undefined,
  };
}

function confirmUrl(env: Env, token: string): string {
  return `${publicBase(env)}/confirm?token=${token}`;
}

export async function requestCoffee(
  env: Env,
  input: { email: string; note?: string; source: "mcp" | "web"; ip?: string },
  now = new Date(),
): Promise<CoffeeResult> {
  const kv = env.COFFEE_KV;
  const email = normalizeEmail(input.email);
  if (!isValidEmail(email)) {
    return { state: "error", code: "invalid_email", message: "That doesn't look like an email address." };
  }

  if (input.ip && !(await allow(kv, `rl:ip:${input.ip}`, LIMITS.perIpPerHour, 3600))) {
    return { state: "error", code: "rate_limited", message: "Lots of coffee requests from here. Try again in an hour." };
  }

  const existingId = await kv.get(`email:${email}`);
  const existing = existingId ? await loadRequest(kv, existingId) : null;
  if (existing?.status === "booked" && existing.start && new Date(existing.start) > now) {
    return bookedResult(env, existing);
  }

  if (!(await allow(kv, `rl:email:${email}`, LIMITS.perEmailPerDay, DAY))) {
    return { state: "error", code: "rate_limited", message: "Too many coffee requests for that address today. Try again tomorrow." };
  }

  const req: StoredRequest =
    existing?.status === "pending"
      ? { ...existing, note: input.note?.slice(0, 280) ?? existing.note, source: input.source }
      : {
          id: crypto.randomUUID(),
          email,
          note: input.note?.slice(0, 280),
          source: input.source,
          status: "pending",
          token: randomToken(),
          createdAt: now.toISOString(),
        };

  await saveRequest(kv, req);
  await kv.put(`token:${req.token}`, req.id, { expirationTtl: 7 * DAY });
  await kv.put(`email:${email}`, req.id, { expirationTtl: 90 * DAY });
  if (input.source === "mcp") return (await bookRequest(env, req, now)).result;

  const sent = await sendEmail(env, confirmationEmail(email, confirmUrl(env, req.token), env.HOST_NAME));
  req.confirmationDelivery = sent ? "sent" : "failed";
  await saveRequest(kv, req);
  return checkInbox(env, req);
}

export async function confirmCoffee(
  env: Env,
  token: string,
  now = new Date(),
): Promise<{ result: CoffeeResult; slack: "sent" | "skipped" | "failed" | "not_sent" }> {
  const kv = env.COFFEE_KV;
  const id = await kv.get(`token:${token}`);
  const req = id ? await loadRequest(kv, id) : null;
  if (!req) {
    return {
      result: { state: "error", code: "not_found", message: "That link has expired. Put your email in again and we'll send a fresh one." },
      slack: "not_sent",
    };
  }
  if (req.status === "booked") return { result: bookedResult(env, req), slack: "not_sent" };
  return bookRequest(env, req, now);
}

// Sequential retries reuse the stored booking. KV read/write is not atomic:
// concurrent requests can still compete for a slot or send duplicate invites.
async function bookRequest(
  env: Env,
  req: StoredRequest,
  now: Date,
): Promise<{ result: CoffeeResult; slack: "sent" | "skipped" | "failed" | "not_sent" }> {
  const kv = env.COFFEE_KV;
  const slot = await proposeSlot(now, env.TIMEZONE, async (iso) => (await kv.get(`slot:${iso}`)) !== null);
  await kv.put(`slot:${slot.start.toISOString()}`, req.id, { expirationTtl: 60 * DAY });

  const booked: StoredRequest = {
    ...req,
    status: "booked",
    start: slot.start.toISOString(),
    end: slot.end.toISOString(),
    inviteDelivery: "unknown",
  };
  await saveRequest(kv, booked);

  const result = bookedResult(env, booked);
  const event = calendarEvent(env, booked);
  if (result.state === "booked" && event) {
    const sent = await sendEmail(
      env,
      inviteEmail({
        to: booked.email,
        cc: env.HOST_EMAIL,
        when: result.when,
        place: result.place,
        placeUrl: result.placeUrl,
        hostName: env.HOST_NAME,
        googleCalendarUrl: result.googleCalendarUrl,
        ics: buildIcs(event, now),
      }),
    );
    booked.inviteDelivery = sent ? "sent" : "failed";
    await saveRequest(kv, booked);
    const slack = await notifySlack(env, {
      email: booked.email,
      when: result.when,
      place: result.place,
      note: booked.note,
      source: booked.source,
      requestId: booked.id,
    });
    return { result: bookedResult(env, booked), slack };
  }
  return { result, slack: "not_sent" };
}

export async function coffeeStatus(env: Env, requestId: string): Promise<CoffeeResult> {
  const req = await loadRequest(env.COFFEE_KV, requestId);
  if (!req) return { state: "error", code: "not_found", message: "No coffee request with that id." };
  return req.status === "booked" ? bookedResult(env, req) : checkInbox(env, req);
}

export async function coffeeIcs(env: Env, requestId: string): Promise<string | null> {
  const req = await loadRequest(env.COFFEE_KV, requestId);
  const event = req ? calendarEvent(env, req) : null;
  return event ? buildIcs(event) : null;
}
