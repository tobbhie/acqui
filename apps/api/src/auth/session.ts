import type { Q } from '../db';
import { randomToken, sha256 } from '../lib/crypto';

export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const OAUTH_FLOW_TTL_MS = 10 * 60 * 1000;

export interface SessionUser {
  sessionId: string;
  userId: string;
  email: string;
  name: string | null;
  csrfToken: string;
}

export interface GoogleUserInput {
  sub: string;
  email: string;
  name: string | null;
}

export async function saveOAuthFlow(
  q: Q,
  flow: { state: string; codeVerifier: string; nonce: string },
  now: Date,
): Promise<void> {
  await q`
    INSERT INTO oauth_flows (state_hash, code_verifier, nonce, expires_at)
    VALUES (${sha256(flow.state)}, ${flow.codeVerifier}, ${flow.nonce}, ${new Date(now.getTime() + OAUTH_FLOW_TTL_MS)})`;
}

/** Single use: the row is deleted as it is read, so a callback URL cannot be replayed. */
export async function consumeOAuthFlow(
  q: Q,
  state: string,
  now: Date,
): Promise<{ state: string; codeVerifier: string; nonce: string } | null> {
  const rows = await q<{ code_verifier: string; nonce: string; expires_at: Date }[]>`
    DELETE FROM oauth_flows WHERE state_hash = ${sha256(state)}
    RETURNING code_verifier, nonce, expires_at`;
  const row = rows[0];
  if (!row || row.expires_at.getTime() <= now.getTime()) return null;
  return { state, codeVerifier: row.code_verifier, nonce: row.nonce };
}

export async function upsertUser(q: Q, input: GoogleUserInput): Promise<string> {
  const rows = await q<{ id: string }[]>`
    INSERT INTO users (google_sub, email, email_verified, name)
    VALUES (${input.sub}, ${input.email}, true, ${input.name})
    ON CONFLICT (google_sub) DO UPDATE
      SET email = EXCLUDED.email, name = EXCLUDED.name, last_login_at = now()
    RETURNING id`;
  const row = rows[0];
  if (!row) throw new Error('user upsert failed');
  return row.id;
}

export async function createSession(q: Q, userId: string, now: Date): Promise<{ token: string; csrfToken: string }> {
  const token = randomToken(32);
  const csrfToken = randomToken(24);
  await q`
    INSERT INTO sessions (user_id, token_hash, csrf_token, expires_at)
    VALUES (${userId}, ${sha256(token)}, ${csrfToken}, ${new Date(now.getTime() + SESSION_TTL_MS)})`;
  return { token, csrfToken };
}

export async function loadSession(q: Q, token: string, now: Date): Promise<SessionUser | null> {
  const rows = await q<{ id: string; user_id: string; email: string; name: string | null; csrf_token: string }[]>`
    SELECT s.id, s.user_id, u.email, u.name, s.csrf_token
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ${sha256(token)} AND s.revoked_at IS NULL AND s.expires_at > ${now}`;
  const row = rows[0];
  if (!row) return null;
  return { sessionId: row.id, userId: row.user_id, email: row.email, name: row.name, csrfToken: row.csrf_token };
}

export async function revokeSession(q: Q, sessionId: string): Promise<void> {
  await q`UPDATE sessions SET revoked_at = now() WHERE id = ${sessionId} AND revoked_at IS NULL`;
}
