# Coffee at OpenWork / SF

## The invitation

> Hey this is OpenWork.
> We make some mean coffee.
> Come get coffee with us.

Hover or keyboard-focus **mean coffee** to reveal **aka good coffee.**

**Meet at OpenWork · 700 Alabama St, San Francisco.**

## Agent first, UI optional

`grab_coffee({})` returns `ask_email` and opens the empty email form. It does not book or email anything. The agent asks for an email in the conversation; the person may also type it into the card.

`grab_coffee({ email, note? })` immediately reserves the next available configured slot and attempts to send the invitation. No UI click or email confirmation is needed. The response includes all booking fields and `inviteDelivery`. A repeated call for the same email reuses its future booking without sending another invite.

The UI is a projection of the tool result—not a step in the workflow. On `booked`, the email input is populated and a filled paper ticket replaces the form. The date, address and calendar links all come from `structuredContent`; the app never makes a second booking just to animate it.

`coffee_status({ requestId })` returns the existing booking. Agent and card distinguish provider-accepted, failed and unknown delivery; a reservation is never presented as proof of inbox delivery.

The standalone web form retains email verification. Confirming on GET is forbidden so link scanners cannot reserve a time. MCP clients do not use that path.

## Art direction

An invitation pinned to the neighborhood, not a SaaS signup screen:

- Full-bleed photographic Gaussian-splat street, with slow camera drift and optional drag-to-look.
- Oversized sans-serif opening and italic serif **mean coffee**.
- Warm paper, ink green-black, vermilion accents; sharp paper form and lightly crooked printed ticket.
- Small monospace folio, address and scene credits.
- No modal, wizard, gradient glass or required interaction with the 3D scene.
- On phones, readable type and a stacked email/button form; reduced-motion disables drift and UI animations.

## The world

The scene is the user's public Marble world, **Urban Intersection in San Francisco**:
https://marble.worldlabs.ai/world/65f3661f-de05-44f3-a9b8-7fcaa142d0ec

`app/world.ts` holds its public 150k-splat export URL, source-image fallback and scale metadata. No World Labs API key is required at runtime or stored in this repository. The source image is only a loading/error fallback; “LIVE 3D” appears only after the real Gaussian asset is ready.

MCP Apps declare only the World Labs CDN origin in their CSP. Do not weaken the host sandbox or enable eval to render the scene.

## Scheduling limitations

Slots are fixed weekdays at 10:00, 14:00 and 16:00 Pacific, at least 18 hours out. They are **not** read from anyone's Google Calendar. Current storage is eventually-consistent KV: sequential duplicate calls are idempotent, but concurrent booking requests are not transactionally locked. Before a wider launch, move slot reservations into a Durable Object or transactional store.

Emails use Cloudflare Email Service, with optional Resend fallback. Slack integration needs a webhook or bot token configured separately. Do not claim Slack delivery until configured and verified.
