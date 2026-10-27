/** Shared logger: the only module allowed to touch `console`. */

type Fields = Record<string, string | number | boolean | undefined>;

function emit(
    level: "debug" | "info" | "warn" | "error",
    msg: string,
    fields: Fields,
): void {
    const line = `[Trackfud:${level}] ${msg} ${JSON.stringify(fields)}`;
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.info(line);
}

/** Shared logger for the Customer app. Side effects live here, never in helpers. */
export const logger = {
    /** Log a debug trace (local diagnosis only). */
    debug: (msg: string, fields: Fields = {}): void =>
        emit("debug", msg, fields),
    /** Log an informational event (order placed, WS reconnected). */
    info: (msg: string, fields: Fields = {}): void => emit("info", msg, fields),
    /** Log a recoverable problem (push denied, Paddle not configured). */
    warn: (msg: string, fields: Fields = {}): void => emit("warn", msg, fields),
    /** Log a failure with technical detail for diagnosis. */
    error: (msg: string, fields: Fields = {}): void =>
        emit("error", msg, fields),
};
