import type { Alerts } from './alerts';
import type { Logger } from './types';

export interface LoopState {
  name: string;
  lastSuccessAt: Date | null;
  consecutiveErrors: number;
  lastError: string | null;
}

/**
 * Runs `run` repeatedly until aborted. Errors never kill the process: the loop backs off (capped at 60s), raises an
 * alert after three consecutive failures (this is how an unreachable RPC surfaces) and clears it on the next success.
 */
export function startLoop(opts: {
  name: string;
  intervalMs: number;
  run: () => Promise<void>;
  signal: AbortSignal;
  log: Logger;
  alerts: Alerts;
  state: LoopState;
  now: () => Date;
}): Promise<void> {
  const { state } = opts;
  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, ms);
      opts.signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
    });
  return (async () => {
    while (!opts.signal.aborted) {
      try {
        await opts.run();
        state.lastSuccessAt = opts.now();
        state.consecutiveErrors = 0;
        state.lastError = null;
        opts.alerts.clear(`loop_failing:${opts.name}`);
        await sleep(opts.intervalMs);
      } catch (error) {
        state.consecutiveErrors += 1;
        state.lastError = error instanceof Error ? error.message.slice(0, 300) : 'unknown error';
        opts.log.error('loop_error', { loop: opts.name, consecutive: state.consecutiveErrors, error: state.lastError });
        if (state.consecutiveErrors >= 3) {
          opts.alerts.raise(`loop_failing:${opts.name}`, `The ${opts.name} loop keeps failing (RPC or database problem?)`, { error: state.lastError });
        }
        await sleep(Math.min(opts.intervalMs * 2 ** Math.min(state.consecutiveErrors, 5), 60_000));
      }
    }
  })();
}
