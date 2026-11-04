/** The slice of Workers KV this app uses. */
export interface KV {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface Env {
  COFFEE_KV: KV;
  PUBLIC_URL: string;
  CITY: string;
  TIMEZONE: string;
  HOST_NAME: string;
  COFFEE_PLACE: string;
  COFFEE_PLACE_URL?: string;
  EMAIL_FROM: string;
  HOST_EMAIL?: string;
  RESEND_API_KEY?: string;
  SLACK_WEBHOOK_URL?: string;
  SLACK_BOT_TOKEN?: string;
  SLACK_CHANNEL_ID?: string;
  /** "1" returns the confirm link in responses so the flow works without email. */
  DEV_MODE?: string;
}

export function cityPath(env: Env): string {
  return `/${env.CITY || "sf"}`;
}

export function publicBase(env: Env): string {
  return `${env.PUBLIC_URL.replace(/\/+$/, "")}${cityPath(env)}`;
}
