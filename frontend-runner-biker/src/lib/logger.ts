/** Shared logger: the only module allowed to touch `console`. */

type Level = 'info' | 'warn' | 'error';

function emit(level: Level, message: string, detail?: unknown): void {
  if (typeof console === 'undefined') return;
  if (detail === undefined) {
    console[level](`[courier] ${message}`);
    return;
  }
  console[level](`[courier] ${message}`, detail);
}

/** Structured app logger. Use instead of `console.log` everywhere. */
export const logger = {
  /** Normal operational event (session start, batch sent, offer shown). */
  info(message: string, detail?: unknown): void {
    emit('info', message, detail);
  },
  /** Recoverable problem (WS drop, HTTP fallback, GPS gap). */
  warn(message: string, detail?: unknown): void {
    emit('warn', message, detail);
  },
  /** Failure surfaced to the user or dropped data. */
  error(message: string, detail?: unknown): void {
    emit('error', message, detail);
  },
};
