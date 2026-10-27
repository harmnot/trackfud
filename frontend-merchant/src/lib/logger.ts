/** Shared logger: the only module allowed to touch `console`. */

type Fields = Record<string, string | number | boolean>;

function line(level: string, msg: string, fields: Fields): string {
  const extra = Object.entries(fields)
    .map(([k, v]) => `${k}=${String(v)}`)
    .join(' ');
  return extra ? `[merchant] ${level} ${msg} ${extra}` : `[merchant] ${level} ${msg}`;
}

/** Structured logger — use instead of `console.log` in production code. */
export const logger = {
  /** Debug detail for local development. */
  debug(msg: string, fields: Fields = {}): void {
    console.debug(line('debug', msg, fields));
  },
  /** Normal operational events. */
  info(msg: string, fields: Fields = {}): void {
    console.info(line('info', msg, fields));
  },
  /** Recoverable problems; user already saw a safe message. */
  warn(msg: string, fields: Fields = {}): void {
    console.warn(line('warn', msg, fields));
  },
  /** Failures surfaced to the user as a safe message. */
  error(msg: string, fields: Fields = {}): void {
    console.error(line('error', msg, fields));
  },
};
