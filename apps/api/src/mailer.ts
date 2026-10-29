import nodemailer from 'nodemailer';
import type { ApiConfig } from '@acqui/shared';
import type { Mailer } from './context';

export const OQUMAIL_DEFAULT_URL = 'https://api.oqumail.com/api/v1/emails';
type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{ status: number }>;

/**
 * Oqumail transactional API, as documented in Oqumail's own guides: `POST /api/v1/emails` with
 * `Authorization: Bearer <per-mailbox key>` and a JSON body `{ to, subject, text }`. The sender address is configured in
 * Oqumail itself, so none is sent from here. `202` means queued.
 * Retries only network errors, 429 and 5xx (never 4xx), with exponential backoff and jitter, at most 3 attempts.
 */
export function createOqumailMailer(opts: { apiKey: string; url?: string; fetchImpl?: FetchLike; sleep?: (ms: number) => Promise<void> }): Mailer {
  const url = opts.url ?? OQUMAIL_DEFAULT_URL;
  const doFetch: FetchLike = opts.fetchImpl ?? ((u, init) => fetch(u, init));
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  return {
    async send(message) {
      const body = JSON.stringify({ to: message.to, subject: message.subject, text: message.text });
      let lastError = 'unknown';
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          const res = await doFetch(url, {
            method: 'POST',
            headers: { authorization: `Bearer ${opts.apiKey}`, 'content-type': 'application/json' },
            body,
            signal: AbortSignal.timeout(15_000),
          });
          if (res.status === 202 || res.status === 200) return;
          lastError = `status ${res.status}`;
          if (res.status !== 429 && res.status < 500) break;
        } catch {
          lastError = 'network error';
        }
        if (attempt < 3) await sleep(1000 * 2 ** (attempt - 1) * (0.5 + Math.random()));
      }
      throw new Error(`Oqumail send failed (${lastError})`);
    },
  };
}

/** Plain SMTP through nodemailer, for any provider with documented SMTP credentials. */
export function createSmtpMailer(config: ApiConfig): Mailer {
  const transport = nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_PORT === 465,
    requireTLS: config.SMTP_PORT !== 465,
    auth: { user: config.SMTP_USER, pass: config.SMTP_PASSWORD },
  });
  return {
    async send(message) {
      await transport.sendMail({ from: config.EMAIL_FROM, to: message.to, subject: message.subject, text: message.text });
    },
  };
}

/** Null when no complete email channel is configured: payout address changes are then disabled. */
export function createMailer(config: ApiConfig): Mailer | null {
  if (config.emailProvider === 'oqumail' && config.OQUMAIL_API_KEY) return createOqumailMailer({ apiKey: config.OQUMAIL_API_KEY });
  if (config.emailProvider === 'smtp') return createSmtpMailer(config);
  return null;
}
