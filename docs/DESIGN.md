# Coffee at OpenWork / SF

## The invitation

> Visit us at our office and get a free cup of some of the best coffee in SF.

The header uses the exact `openwork-sidebar-mark.svg` from the desktop app beside the OpenWork name. `app/brand.css` copies the app's slate tokens, navy accent, system font stack, radii and card shadow. Keep the restrained layout; don't turn it into a marketing landing page.

**San Francisco. The full meeting address is included only in the invitation email and its attached calendar file—not the page, MCP response, public calendar download or booking panel.**

## Agent first, UI optional

`grab_coffee({})` returns `ask_email` and opens the empty email form. It does not book or email anything. The agent asks for an email in the conversation; the person may also type it into the card.

`grab_coffee({ email, note? })` immediately reserves the next available configured slot and attempts to send the invitation. No UI click or email confirmation is needed. The response includes all booking fields and `inviteDelivery`. A repeated call for the same email reuses its future booking without sending another invite.

The UI is a projection of the tool result—not a step in the workflow. On `booked`, the email input is populated and a simple booking panel replaces the form. The date, address and calendar links all come from `structuredContent`; the app never makes a second booking just to animate it.

`coffee_status({ requestId })` returns the existing booking. Agent and card distinguish provider-accepted, failed and unknown delivery; a reservation is never presented as proof of inbox delivery.

The standalone web form retains email verification. Confirming on GET is forbidden so link scanners cannot reserve a time. MCP clients do not use that path.

## Art direction

A small utility over the real neighborhood, not a marketing landing page:

- Simple top-down neighborhood map, built from real OpenStreetMap roads and building footprints. Drag to explore; no exact meeting-location pin.
- Small OpenWork header. One compact, bottom-centered panel holds the invitation and email field. It says the address will arrive by email.
- System sans-serif, restrained green/gray, soft off-white panel. No oversized headings, badges, italics, stamps or faux paper receipt.
- The booked state uses the same compact panel with a date and calendar buttons. The precise address remains in the email.
- The public website is install-only: “Add to your agent”, the URL, client tabs and instructions, expanded by default. The map and booking form appear only in the MCP App.
- On phones, the field and button stack. Reduced-motion disables camera drift and transitions.

## The map

`app/neighborhood.svg` is a bundled, top-down map of the Mission District: 2,311 real building footprints and 391 road segments, derived from OpenStreetMap. It is a neighborhood overview, not a map to the exact meeting address. There is no location pin. Attribution stays visible in the footer.

`scripts/build-neighborhood-map.py` regenerates the SVG from the documented public OSM API extract. The app needs no external tiles, credentials, WebGL, WASM or network access for its map. MCP Apps declare no external resource/connect origins.

The prior World Labs reconstruction and renderers remain in source for reference but are no longer loaded.

## Scheduling limitations

Slots are fixed weekdays at 10:00, 14:00 and 16:00 Pacific, at least 18 hours out. They are **not** read from anyone's Google Calendar. Current storage is eventually-consistent KV: sequential duplicate calls are idempotent, but concurrent booking requests are not transactionally locked. Before a wider launch, move slot reservations into a Durable Object or transactional store.

Emails use Cloudflare Email Service, with optional Resend fallback. Slack integration needs a webhook or bot token configured separately. Do not claim Slack delivery until configured and verified.
