import type { Logger } from './types';

export interface Alerts {
  /** Raises (or refreshes) an alert. Repeats within the cooldown are suppressed so a stuck condition does not spam. */
  raise(code: string, message: string, details?: Record<string, unknown>): void;
  clear(code: string): void;
  active(): { code: string; message: string; since: Date }[];
}

export function createAlerts(opts: {
  log: Logger;
  now: () => Date;
  cooldownMs?: number;
  /** Optional operator channel (a chat or paging webhook). Failures here never affect payments. */
  send?: (payload: { code: string; message: string; details: Record<string, unknown>; at: string }) => Promise<void>;
}): Alerts {
  const cooldown = opts.cooldownMs ?? 10 * 60_000;
  const state = new Map<string, { message: string; since: Date; lastSent: number }>();
  return {
    raise(code, message, details = {}) {
      const now = opts.now();
      const existing = state.get(code);
      if (existing && now.getTime() - existing.lastSent < cooldown) return;
      state.set(code, { message, since: existing?.since ?? now, lastSent: now.getTime() });
      opts.log.error('alert', { code, message, ...details });
      void opts.send?.({ code, message, details, at: now.toISOString() }).catch(() => undefined);
    },
    clear(code) {
      if (state.delete(code)) opts.log.info('alert_cleared', { code });
    },
    active: () => [...state.entries()].map(([code, v]) => ({ code, message: v.message, since: v.since })),
  };
}

export function createWebhookAlertSender(url: string): NonNullable<Parameters<typeof createAlerts>[0]['send']> {
  return async (payload) => {
    await fetch(url, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000), redirect: 'manual',
    });
  };
}
