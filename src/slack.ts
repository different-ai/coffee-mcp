import type { Env } from "./env";

export interface BookingNotice {
  email: string;
  when: string;
  place: string;
  note?: string;
  source: "mcp" | "web";
  requestId: string;
}

export type SlackOutcome = "sent" | "skipped" | "failed";

function esc(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function bookingMessage(notice: BookingNotice) {
  const lines = [
    `*Who:* ${esc(notice.email)}`,
    `*When:* ${esc(notice.when)}`,
    `*Where:* ${esc(notice.place)}`,
  ];
  if (notice.note) lines.push(`*Note:* ${esc(notice.note)}`);
  return {
    text: `☕ New coffee booked: ${notice.email} · ${notice.when}`,
    blocks: [
      { type: "header", text: { type: "plain_text", text: "☕ New coffee in SF" } },
      { type: "section", text: { type: "mrkdwn", text: lines.join("\n") } },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `via ${notice.source === "mcp" ? "an agent (MCP)" : "coffee.openworklabs.com"} · ${notice.requestId}`,
          },
        ],
      },
    ],
  };
}

/** Posts to #coffee-requests via a bot token or an incoming webhook. Never throws. */
export async function notifySlack(env: Env, notice: BookingNotice): Promise<SlackOutcome> {
  const message = bookingMessage(notice);
  try {
    if (env.SLACK_BOT_TOKEN && env.SLACK_CHANNEL_ID) {
      const res = await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: {
          authorization: `Bearer ${env.SLACK_BOT_TOKEN}`,
          "content-type": "application/json; charset=utf-8",
        },
        body: JSON.stringify({ channel: env.SLACK_CHANNEL_ID, ...message }),
      });
      const body: unknown = await res.json();
      const ok = typeof body === "object" && body !== null && "ok" in body && body.ok === true;
      return ok ? "sent" : "failed";
    }
    if (env.SLACK_WEBHOOK_URL) {
      const res = await fetch(env.SLACK_WEBHOOK_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(message),
      });
      return res.ok ? "sent" : "failed";
    }
    return "skipped";
  } catch (error) {
    console.error("slack notify failed", error);
    return "failed";
  }
}
