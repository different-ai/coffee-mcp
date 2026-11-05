// Shared between the Worker and the 3D view.

export type CoffeeErrorCode = "invalid_email" | "rate_limited" | "not_found" | "internal" | "email_delivery_failed";

// "sent" means the email provider accepted the message, not inbox delivery.
export type InviteDelivery = "sent" | "failed" | "unknown";

export type CoffeeResult =
  | { state: "ask_email"; email?: string }
  | { state: "check_inbox"; email: string; requestId: string; devConfirmUrl?: string }
  | {
      state: "booked";
      email: string;
      requestId: string;
      start: string;
      end: string;
      when: string;
      place: string;
      placeUrl?: string;
      calendarUrl: string;
      googleCalendarUrl: string;
      inviteDelivery: InviteDelivery;
    }
  | { state: "error"; code: CoffeeErrorCode; message: string; requestId?: string };

const STATES = ["ask_email", "check_inbox", "booked", "error"];

export function isCoffeeResult(value: unknown): value is CoffeeResult {
  return (
    typeof value === "object" &&
    value !== null &&
    "state" in value &&
    typeof value.state === "string" &&
    STATES.includes(value.state)
  );
}
