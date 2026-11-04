# coffee.openworklabs.com/sf: experience design

**In one sentence:** you add one URL to your agent, say "grab coffee with
OpenWork", a small 3D San Francisco coffee scene opens right in the chat and
asks you to put your email address, and a few minutes later you get an email
with a time and place.

## 1. Adding it (under 30 seconds)

- One URL, `https://coffee.openworklabs.com/sf`. No API key, no sign-in.
- In a browser, the same URL is the landing page: the 3D scene, the "Put your
  email address" box, and one-click install for Claude Code, Cursor, Codex,
  VS Code, OpenWork, Claude.ai and ChatGPT.
- Browsers get HTML and MCP clients get MCP from the same path, so the URL
  stays exactly `coffee.openworklabs.com/sf`. `/sf` leaves room for `/nyc`.

## 2. In the chat

1. The user says "get me coffee with the OpenWork team". The agent calls `grab_coffee`.
2. If the agent already has the email (and the user gave it for this), it's filled in.
3. The 3D card opens (MCP Apps, `ui://coffee/sf.html`): dusk over the Golden
   Gate, fog rolling through the towers, an empty cup on a café table, one
   field ("Put your email address") and one button (**Grab a coffee**).
4. Submit: coffee pours into the cup, steam rises, and a paper receipt prints:
   *"Check your inbox."*
5. The user confirms the email, which stops strangers booking coffee for
   someone else's address.
6. They get an email with the time, the café, a calendar invite and "can't
   make it? reply".
7. Back in the chat the receipt flips to the confirmed time with "Add to
   calendar", and the camera eases toward the cup.

Clients without MCP Apps still work in text: the agent asks for the email and
the reply says "check your inbox".

## 3. Tools

| Tool | What it does |
|---|---|
| `grab_coffee({ email?, note? })` | Opens the 3D card, or sends the request right away with an email |
| `coffee_status({ requestId })` | "When's my coffee?" Returns the time and place once booked |

Status is by `requestId`, not email, so nobody can look up someone else's coffee.

## 4. Decisions made for the prototype (easy to change)

| Question | Prototype default | Where to change |
|---|---|---|
| Whose calendar decides? | Fixed weekday slots, no double booking | `src/schedule.ts` (swap in Google Calendar free/busy) |
| One time or three? | One time, the next open slot | `src/coffee.ts` |
| Where? | One café, configurable | `COFFEE_PLACE` in `wrangler.jsonc` |
| Who's notified? | `#coffee-requests` on every confirmed booking | `src/slack.ts` |
| Sender | `coffee@openworklabs.com` via Resend | `EMAIL_FROM` |
