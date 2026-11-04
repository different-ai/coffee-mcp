import type { Env } from "./env";

export interface OutgoingEmail {
  to: string;
  cc?: string;
  subject: string;
  html: string;
  text: string;
  attachments?: { filename: string; content: string; contentType?: string }[];
}

function toBase64(value: string): string {
  let binary = "";
  for (const byte of new TextEncoder().encode(value)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function parseFrom(from: string): { email: string; name?: string } {
  const match = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(from);
  return match?.[2] ? { name: match[1] || undefined, email: match[2] } : { email: from.trim() };
}

/**
 * Sends through the Cloudflare Email Service binding when bound, else Resend.
 * Returns false (and logs) when unconfigured or failing; never throws.
 */
export async function sendEmail(env: Env, email: OutgoingEmail): Promise<boolean> {
  try {
    if (env.EMAIL) {
      await env.EMAIL.send({
        to: email.to,
        cc: email.cc,
        from: parseFrom(env.EMAIL_FROM),
        replyTo: env.HOST_EMAIL,
        subject: email.subject,
        html: email.html,
        text: email.text,
        attachments: email.attachments?.map((a) => ({
          content: toBase64(a.content),
          filename: a.filename,
          type: a.contentType ?? "application/octet-stream",
          disposition: "attachment",
        })),
      });
      return true;
    }
    if (!env.RESEND_API_KEY) {
      console.log(`[email skipped: no EMAIL binding or RESEND_API_KEY] to=${email.to} subject=${email.subject}`);
      return false;
    }
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: env.EMAIL_FROM,
        to: [email.to],
        cc: email.cc ? [email.cc] : undefined,
        subject: email.subject,
        html: email.html,
        text: email.text,
        attachments: email.attachments?.map((a) => ({
          filename: a.filename,
          content: toBase64(a.content),
          content_type: a.contentType,
        })),
      }),
    });
    if (!res.ok) console.error("resend failed", res.status, await res.text());
    return res.ok;
  } catch (error) {
    console.error("email send failed", error);
    return false;
  }
}

function escHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function layout(body: string): string {
  return `<!doctype html><html><body style="margin:0;background:#f6efe8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#2a1f1a">
<div style="max-width:480px;margin:0 auto;padding:40px 24px">
<p style="font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#a0705a;margin:0 0 16px">OpenWork Coffee · SF</p>
${body}
<p style="font-size:12px;color:#9b8b80;margin-top:40px">You got this because someone put this address into coffee.openworklabs.com/sf. If it wasn't you, ignore this email and nothing happens.</p>
</div></body></html>`;
}

function button(href: string, label: string): string {
  return `<a href="${escHtml(href)}" style="display:inline-block;background:#2a1f1a;color:#fff6ef;text-decoration:none;padding:14px 22px;border-radius:999px;font-weight:600">${escHtml(label)}</a>`;
}

export function confirmationEmail(to: string, confirmUrl: string, hostName: string): OutgoingEmail {
  return {
    to,
    subject: "Confirm your coffee in SF ☕",
    text: `Confirm your email and we'll send you a time to grab a coffee with ${hostName}:\n\n${confirmUrl}\n`,
    html: layout(`<h1 style="font-size:24px;margin:0 0 12px">One tap and the coffee's on.</h1>
<p style="font-size:16px;line-height:1.5;margin:0 0 24px">Confirm your email and we'll send you a time to grab a coffee with ${escHtml(hostName)} in San Francisco.</p>
${button(confirmUrl, "Confirm my coffee")}`),
  };
}

export function inviteEmail(input: {
  to: string;
  cc?: string;
  when: string;
  place: string;
  placeUrl?: string;
  hostName: string;
  googleCalendarUrl: string;
  ics: string;
}): OutgoingEmail {
  const where = input.placeUrl
    ? `<a href="${escHtml(input.placeUrl)}" style="color:#2a1f1a">${escHtml(input.place)}</a>`
    : escHtml(input.place);
  return {
    to: input.to,
    cc: input.cc,
    subject: `Coffee with ${input.hostName}: ${input.when}`,
    text: `You're on for coffee with ${input.hostName}.\n\nWhen: ${input.when}\nWhere: ${input.place}\n\nAdd it to Google Calendar: ${input.googleCalendarUrl}\nCan't make it? Just reply to this email.\n`,
    html: layout(`<h1 style="font-size:24px;margin:0 0 20px">You're on for coffee.</h1>
<table style="font-size:16px;line-height:1.6;margin:0 0 24px"><tr><td style="color:#a0705a;padding-right:16px">When</td><td><strong>${escHtml(input.when)}</strong></td></tr>
<tr><td style="color:#a0705a;padding-right:16px">Where</td><td>${where}</td></tr>
<tr><td style="color:#a0705a;padding-right:16px">With</td><td>${escHtml(input.hostName)}</td></tr></table>
${button(input.googleCalendarUrl, "Add to Google Calendar")}
<p style="font-size:14px;color:#6b5a50;margin-top:24px">The invite is attached too. Can't make it? Just reply to this email.</p>`),
    attachments: [{ filename: "coffee.ics", content: input.ics, contentType: "text/calendar; method=REQUEST" }],
  };
}
