import { createHash } from "node:crypto";
import { McpServer, type CallToolResult } from "@modelcontextprotocol/server";
import {
  RESOURCE_MIME_TYPE,
  registerAppResource,
  registerAppTool,
} from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";
import appHtml from "../dist/app.html";
import { coffeeStatus, requestCoffee } from "./coffee";
import type { Env } from "./env";
import type { CoffeeResult } from "./shared";

// MCP hosts can cache UI resources by URI for much longer than a website page.
// A new HTML build must have a new identity, not just different content at one URI.
export const VIEW_BUILD = createHash("sha256")
  .update(appHtml)
  .digest("hex")
  .slice(0, 16);
export const VIEW_URI = `ui://coffee/sf-${VIEW_BUILD}.html`;
export const LEGACY_VIEW_URI = "ui://coffee/sf.html";

const INSTRUCTIONS = `Book a coffee with the OpenWork team in San Francisco.
Call grab_coffee when the user wants to meet, grab coffee, or chat with OpenWork in person.
Without an email it shows an empty coffee card: ask the user for their email, then call
grab_coffee again with it. Only pass an email if the user gave it to you for this purpose.
With an email it immediately reserves a time and place and attempts to send a calendar
invite to the user and configured host. No email confirmation or UI click is required;
the card visualizes the result. Check inviteDelivery before saying the invite was sent:
"sent" means accepted by the email provider, "failed" means it could not be sent, and
"unknown" means the send outcome isn't known. A future booking for the same email is
reused without another invite. Use coffee_status with the requestId to retrieve it.`;

function describe(result: CoffeeResult): string {
  switch (result.state) {
    case "ask_email":
      return "Showing an empty coffee card. Ask the user for their email address, then call grab_coffee again with that email to book directly and send the invite. No confirmation click is needed.";
    case "check_inbox":
      return `Coffee requested. We emailed ${result.email} a confirmation link; after they tap it, they get a time and a calendar invite. requestId: ${result.requestId}`;
    case "booked":
      return `Coffee booked for ${result.when} at ${result.place} for ${result.email}. ${
        result.inviteDelivery === "sent"
          ? "The email provider accepted the calendar invite."
          : result.inviteDelivery === "failed"
            ? "The invite could not be sent; the booking is reserved. Use the calendar links to add it."
            : "The invite send outcome is unknown; the booking is reserved. Use the calendar links to add it."
      } No confirmation click is needed. requestId: ${result.requestId}`;
    case "error":
      return result.message;
  }
}

function toToolResult(result: CoffeeResult): CallToolResult {
  return {
    content: [{ type: "text", text: describe(result) }],
    structuredContent: { ...result },
    isError:
      result.state === "error" && result.code !== "rate_limited"
        ? true
        : undefined,
  };
}

export function buildServer(env: Env, ctx: { ip?: string }): McpServer {
  const server = new McpServer(
    {
      name: "coffee-sf",
      title: "Coffee in SF · OpenWork",
      version: `0.2.0+${VIEW_BUILD}`,
    },
    { instructions: INSTRUCTIONS },
  );

  registerAppTool(
    server,
    "grab_coffee",
    {
      title: "Grab a coffee in SF",
      description:
        "Book a coffee with the OpenWork team in San Francisco. Without email, shows an empty card: ask the user for their email and call again. Only pass an email the user gave for this purpose. With email, immediately reserve a time and place and attempt to email a calendar invite to the user and configured host, without confirmation clicks. The card visualizes the booking; check inviteDelivery for send failures. Reuses an existing future booking without sending another invite.",
      inputSchema: z.object({
        email: z
          .string()
          .optional()
          .describe(
            "The user's email. Only include it if the user gave it for booking coffee; this immediately books and attempts to send an invite. Otherwise ask the user for it.",
          ),
        note: z
          .string()
          .max(280)
          .optional()
          .describe(
            "Optional note for the team, e.g. what they'd like to chat about.",
          ),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      _meta: { ui: { resourceUri: VIEW_URI, visibility: ["model", "app"] } },
    },
    async ({ email, note }) => {
      if (email === undefined) return toToolResult({ state: "ask_email" });
      return toToolResult(
        await requestCoffee(env, { email, note, source: "mcp", ip: ctx.ip }),
      );
    },
  );

  registerAppTool(
    server,
    "coffee_status",
    {
      title: "Check a coffee booking",
      description:
        "Retrieve a coffee booking's time, place, calendar links and inviteDelivery send outcome, or the status of a legacy web confirmation request.",
      inputSchema: z.object({
        requestId: z
          .string()
          .describe("The requestId returned by grab_coffee."),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: { ui: { resourceUri: VIEW_URI, visibility: ["model", "app"] } },
    },
    async ({ requestId }) => toToolResult(await coffeeStatus(env, requestId)),
  );

  // Keep the old URI readable for clients holding an older tools/list result.
  for (const uri of [VIEW_URI, LEGACY_VIEW_URI]) {
    registerAppResource(
      server,
      uri === VIEW_URI ? "Coffee in SF" : "Coffee in SF (legacy resource URL)",
      uri,
      {
        description:
          "A top-down San Francisco neighborhood map with the booking returned by grab_coffee or coffee_status. The exact meeting address is sent only by email.",
      },
      async () => ({
        contents: [
          {
            uri,
            mimeType: RESOURCE_MIME_TYPE,
            text: appHtml,
            _meta: {
              ui: {
                prefersBorder: false,
                csp: {
                  connectDomains: [],
                  resourceDomains: [],
                },
              },
            },
          },
        ],
      }),
    );
  }

  return server;
}
