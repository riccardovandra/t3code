import type { ApiTokenSummary } from "../shared/protocol.ts";
import { randomId, randomSixDigitCode, randomToken, sha256Hex, timingSafeEqual } from "./crypto.ts";

export const LOGIN_CODE_TTL_MS = 10 * 60 * 1000;
export const LOGIN_CODE_MAX_ATTEMPTS = 5;
/** A repeat request inside this window keeps the code already sent. */
export const LOGIN_CODE_RESEND_INTERVAL_MS = 30 * 1000;
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const SESSION_COOKIE = "docs_session";
const API_TOKEN_PREFIX = "dct_";

export type Principal =
  | { readonly kind: "session"; readonly email: string }
  | { readonly kind: "token"; readonly tokenId: string };

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function parseOwnerEmails(value: string): ReadonlySet<string> {
  return new Set(value.split(",").map(normalizeEmail).filter(Boolean));
}

const codeHash = (email: string, code: string) => sha256Hex(`${email}:${code}`);

/**
 * Issues a code for an allowlisted email. Returns the code to deliver, or null
 * when nothing should be sent; callers must answer identically either way so
 * the response never reveals which emails are owners.
 */
export async function issueLoginCode(
  db: D1Database,
  input: { readonly email: string; readonly owners: ReadonlySet<string>; readonly now: number },
): Promise<string | null> {
  const email = normalizeEmail(input.email);
  if (!input.owners.has(email)) return null;
  const existing = await db
    .prepare("SELECT created_at FROM login_codes WHERE email = ?")
    .bind(email)
    .first<{ created_at: number }>();
  if (existing && input.now - existing.created_at < LOGIN_CODE_RESEND_INTERVAL_MS) return null;
  const code = randomSixDigitCode();
  await db
    .prepare(
      `INSERT INTO login_codes (email, code_hash, expires_at, attempts, created_at)
       VALUES (?, ?, ?, 0, ?)
       ON CONFLICT(email) DO UPDATE SET code_hash = excluded.code_hash,
         expires_at = excluded.expires_at, attempts = 0, created_at = excluded.created_at`,
    )
    .bind(email, await codeHash(email, code), input.now + LOGIN_CODE_TTL_MS, input.now)
    .run();
  return code;
}

/** Returns a new session token when the code is valid, otherwise null. */
export async function verifyLoginCode(
  db: D1Database,
  input: {
    readonly email: string;
    readonly code: string;
    readonly owners: ReadonlySet<string>;
    readonly now: number;
  },
): Promise<string | null> {
  const email = normalizeEmail(input.email);
  if (!input.owners.has(email)) return null;
  // Spend an attempt before comparing, so parallel guesses cannot all read the
  // same attempt count and slip past the limit.
  const row = await db
    .prepare(
      `UPDATE login_codes SET attempts = attempts + 1
       WHERE email = ? AND attempts < ? AND expires_at > ?
       RETURNING code_hash`,
    )
    .bind(email, LOGIN_CODE_MAX_ATTEMPTS, input.now)
    .first<{ code_hash: string }>();
  if (!row) return null;
  const candidate = await codeHash(email, input.code.trim());
  if (!timingSafeEqual(candidate, row.code_hash)) return null;
  // Single use: only the request that deletes the row gets a session.
  const consumed = await db
    .prepare("DELETE FROM login_codes WHERE email = ? AND code_hash = ?")
    .bind(email, row.code_hash)
    .run();
  if (consumed.meta.changes !== 1) return null;
  return createSession(db, email, input.now);
}

export async function createSession(db: D1Database, email: string, now: number): Promise<string> {
  const token = randomToken();
  await db
    .prepare("INSERT INTO sessions (token_hash, email, expires_at, created_at) VALUES (?, ?, ?, ?)")
    .bind(await sha256Hex(token), email, now + SESSION_TTL_MS, now)
    .run();
  return token;
}

export async function deleteSession(db: D1Database, token: string): Promise<void> {
  await db
    .prepare("DELETE FROM sessions WHERE token_hash = ?")
    .bind(await sha256Hex(token))
    .run();
}

export async function sessionEmail(
  db: D1Database,
  token: string,
  now: number,
): Promise<string | null> {
  const row = await db
    .prepare("SELECT email FROM sessions WHERE token_hash = ? AND expires_at > ?")
    .bind(await sha256Hex(token), now)
    .first<{ email: string }>();
  return row?.email ?? null;
}

export async function createApiToken(
  db: D1Database,
  name: string,
  now: number,
): Promise<{ readonly id: string; readonly token: string }> {
  const id = randomId();
  const token = API_TOKEN_PREFIX + randomToken();
  await db
    .prepare("INSERT INTO api_tokens (id, name, token_hash, created_at) VALUES (?, ?, ?, ?)")
    .bind(id, name, await sha256Hex(token), now)
    .run();
  return { id, token };
}

export async function listApiTokens(db: D1Database): Promise<ReadonlyArray<ApiTokenSummary>> {
  const { results } = await db
    .prepare(
      `SELECT id, name, created_at, last_used_at FROM api_tokens
       WHERE revoked_at IS NULL ORDER BY created_at DESC`,
    )
    .all<{ id: string; name: string; created_at: number; last_used_at: number | null }>();
  return results.map((row) => ({
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  }));
}

export async function revokeApiToken(db: D1Database, id: string, now: number): Promise<boolean> {
  const result = await db
    .prepare("UPDATE api_tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL")
    .bind(now, id)
    .run();
  return result.meta.changes === 1;
}

export async function apiTokenId(
  db: D1Database,
  token: string,
  now: number,
): Promise<string | null> {
  if (!token.startsWith(API_TOKEN_PREFIX)) return null;
  const row = await db
    .prepare(
      `UPDATE api_tokens SET last_used_at = ? WHERE token_hash = ? AND revoked_at IS NULL
       RETURNING id`,
    )
    .bind(now, await sha256Hex(token))
    .first<{ id: string }>();
  return row?.id ?? null;
}

export function readCookie(request: Request, name: string): string | null {
  for (const part of (request.headers.get("Cookie") ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=") || null;
  }
  return null;
}

// SameSite=None + Partitioned lets the session work inside T3 Code's iframe.
export function sessionCookie(token: string, maxAgeMs: number): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=None; Partitioned; Max-Age=${Math.floor(maxAgeMs / 1000)}`;
}

export async function authenticate(
  db: D1Database,
  request: Request,
  now: number,
): Promise<Principal | null> {
  const authorization = request.headers.get("Authorization");
  if (authorization?.startsWith("Bearer ")) {
    const tokenId = await apiTokenId(db, authorization.slice("Bearer ".length).trim(), now);
    return tokenId ? { kind: "token", tokenId } : null;
  }
  const cookie = readCookie(request, SESSION_COOKIE);
  if (!cookie) return null;
  const email = await sessionEmail(db, cookie, now);
  return email ? { kind: "session", email } : null;
}
