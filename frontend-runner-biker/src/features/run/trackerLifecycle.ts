/**
 * Lifecycle primitives for the app-level run tracker. Pure on purpose (no
 * imports, no browser APIs) so `scripts/route-smoke.mjs` can drive them in
 * Node and prove the "one watcher, one upload at a time" guarantees.
 */

/** Holds at most one running instance, keyed by work-session id. */
export type TrackerSlot<K> = {
  /** Run for `key`: no-op when already running for it, replaces any other key. */
  ensure: (key: K) => void;
  /** Stop the running instance; no-op when idle. */
  stop: () => void;
  /** Key of the running instance, or null when idle. */
  activeKey: () => K | null;
};

/**
 * Wrap `start` (binds one instance, returns its stop) in a single slot.
 * Ensuring the same key twice never binds twice, and a new key stops the
 * old instance before the next one binds — two instances never overlap.
 */
export function createTrackerSlot<K>(start: (key: K) => () => void): TrackerSlot<K> {
  let running: { key: K; stop: () => void } | null = null;

  function stop(): void {
    const current = running;
    if (!current) return;
    running = null;
    current.stop();
  }

  return {
    ensure(key: K): void {
      if (running && running.key === key) return;
      stop();
      running = { key, stop: start(key) };
    },
    stop,
    activeKey: () => (running ? running.key : null),
  };
}

/**
 * Wrap an async task so overlapping calls share the run already in flight
 * instead of starting a second one. A caller's argument is dropped while
 * busy on purpose: the next scheduled call picks up whatever is left.
 */
export function createSingleFlight<A>(task: (arg: A) => Promise<void>): (arg: A) => Promise<void> {
  let busy = false;
  let current: Promise<void> = Promise.resolve();

  async function run(arg: A): Promise<void> {
    try {
      await task(arg);
    } finally {
      busy = false;
    }
  }

  return (arg: A): Promise<void> => {
    if (busy) return current;
    busy = true;
    current = run(arg);
    return current;
  };
}
