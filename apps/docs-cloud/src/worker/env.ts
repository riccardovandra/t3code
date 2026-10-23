import type { DocRoom } from "./docRoom.ts";

export interface Env {
  readonly DB: D1Database;
  readonly DOC_ROOM: DurableObjectNamespace<DocRoom>;
  readonly ASSETS: Fetcher;
  /** Comma-separated; every address signs in to the same single owner account. */
  readonly OWNER_EMAILS: string;
  readonly EMAIL_FROM: string;
  /** Unset in local dev: sign-in codes are logged to the console instead. */
  readonly RESEND_API_KEY?: string;
}
