// Shared between the Worker and the 3D view.

export type CoffeeErrorCode = "invalid_email" | "rate_limited" | "not_found" | "internal";

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
    }
  | { state: "error"; code: CoffeeErrorCode; message: string };

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
