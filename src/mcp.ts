import { McpServer, type CallToolResult } from "@modelcontextprotocol/server";
import { RESOURCE_MIME_TYPE, registerAppResource, registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";
import appHtml from "../dist/app.html";
import { coffeeStatus, requestCoffee } from "./coffee";
import type { Env } from "./env";
import type { CoffeeResult } from "./shared";

export const VIEW_URI = "ui://coffee/sf.html";

const INSTRUCTIONS = `Book a coffee with the OpenWork team in San Francisco.
Call grab_coffee when the user wants to meet, grab coffee, or chat with OpenWork in person.
It shows an interactive card where the user puts their email address. Only pass an email
if the user gave it to you for this purpose. After they confirm the email we send them a
time and place; use coffee_status with the requestId to check whether it's booked.`;

function describe(result: CoffeeResult): string {
  switch (result.state) {
    case "ask_email":
      return "Showing the coffee card. The user can put their email address in it. If the card isn't visible in this client, ask the user for their email and call grab_coffee again with it.";
    case "check_inbox":
      return `Coffee requested. We emailed ${result.email} a confirmation link; after they tap it, they get a time and a calendar invite. requestId: ${result.requestId}`;
    case "booked":
      return `Coffee booked for ${result.when} at ${result.place}. The invite went to ${result.email}. requestId: ${result.requestId}`;
    case "error":
      return result.message;
  }
}

function toToolResult(result: CoffeeResult): CallToolResult {
  return {
    content: [{ type: "text", text: describe(result) }],
    structuredContent: { ...result },
    isError: result.state === "error" && result.code !== "rate_limited" ? true : undefined,
  };
}

export function buildServer(env: Env, ctx: { ip?: string }): McpServer {
  const server = new McpServer(
    { name: "coffee-sf", title: "Coffee in SF · OpenWork", version: "0.1.0" },
    { instructions: INSTRUCTIONS },
  );

  registerAppTool(
    server,
    "grab_coffee",
    {
      title: "Grab a coffee in SF",
      description:
        "Book a coffee with the OpenWork team in San Francisco. Shows an interactive card where the user puts their email address; we email them a time and place.",
      inputSchema: z.object({
        email: z
          .string()
          .optional()
          .describe("The user's email. Only include it if the user gave it to you for this; otherwise the card asks for it."),
        note: z.string().max(280).optional().describe("Optional note for the team, e.g. what they'd like to chat about."),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      _meta: { ui: { resourceUri: VIEW_URI } },
    },
    async ({ email, note }) => {
      if (!email) return toToolResult({ state: "ask_email" });
      return toToolResult(await requestCoffee(env, { email, note, source: "mcp", ip: ctx.ip }));
    },
  );

  registerAppTool(
    server,
    "coffee_status",
    {
      title: "Check a coffee booking",
      description: "Check whether a coffee request is confirmed, and get its time and place.",
      inputSchema: z.object({ requestId: z.string().describe("The requestId returned by grab_coffee.") }),
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: { ui: { resourceUri: VIEW_URI } },
    },
    async ({ requestId }) => toToolResult(await coffeeStatus(env, requestId)),
  );

  registerAppResource(
    server,
    "Coffee in SF",
    VIEW_URI,
    { description: "A 3D San Francisco café where you put your email address to grab a coffee." },
    async () => ({
      contents: [
        {
          uri: VIEW_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: appHtml,
          _meta: { ui: { prefersBorder: false } },
        },
      ],
    }),
  );

  return server;
}
