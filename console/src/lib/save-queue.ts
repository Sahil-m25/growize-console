/** Local, in-memory retry state. An online browser is not a write acknowledgement. */
export const SAVE_WAIT_MS = 300_000;

export type SaveSession = { actor: string; session: string | number };
export type SaveTask = SaveSession & {
  key: string;
  id?: string;
  label?: string;
  validate: () => boolean;
  execute: () => boolean | Promise<boolean>;
};
export type SaveStatus = "pending" | "saving" | "failed";
export type SaveEntry = SaveSession & {
  key: string;
  id?: string;
  label?: string;
  status: SaveStatus | "completed";
  enqueuedAt: number;
  deadline: number;
  error?: string;
};
export type SaveChange = {
  kind: "queued" | "saving" | "failed" | "completed" | "reset";
  entry?: SaveEntry;
  entries: SaveEntry[];
};
export type SaveResult = {
  accepted: boolean;
  key: string;
  status: SaveStatus | "completed" | "rejected";
};
export type SaveQueueOptions = {
  clock: () => number;
  setTimer: (callback: () => void, delay: number) => unknown;
  clearTimer: (handle: unknown) => void;
  isOnline: () => boolean;
  currentSession: () => SaveSession | null;
  onChange?: (change: SaveChange) => void;
};
export type SaveQueue = {
  enqueue: (task: SaveTask) => SaveResult;
  retry: (key: string) => SaveResult;
  reconnect: () => void;
  expire: () => void;
  reset: () => void;
  discard: (key: string) => void;
  snapshot: () => SaveEntry[];
};

type InternalEntry = { task: SaveTask; state: SaveEntry; timer?: unknown; completed?: boolean };

export function createSaveQueue(options: SaveQueueOptions): SaveQueue {
  const entries = new Map<string, InternalEntry>();
  const publicEntry = (entry: InternalEntry): SaveEntry => ({ ...entry.state });
  const rawSnapshot = () => [...entries.values()].map(publicEntry);
  const current = (task: SaveSession) => {
    const session = options.currentSession();
    return !!session && session.actor === task.actor && session.session === task.session;
  };
  const cancelTimer = (entry: InternalEntry) => {
    if (entry.timer !== undefined) options.clearTimer(entry.timer);
    entry.timer = undefined;
  };
  const emit = (kind: SaveChange["kind"], entry?: InternalEntry) => {
    // Rendering failures must not change the truth of a completed write.
    try { options.onChange?.({ kind, entry: entry && publicEntry(entry), entries: rawSnapshot() }); }
    catch { /* A consumer may recover its rendering independently. */ }
  };
  const reset = () => {
    entries.forEach(cancelTimer);
    entries.clear();
    emit("reset");
  };
  const discardOtherSessions = () => {
    let discarded = false;
    for (const [key, entry] of entries) {
      if (!current(entry.task)) {
        cancelTimer(entry);
        entries.delete(key);
        discarded = true;
      }
    }
    if (discarded) emit("reset");
  };
  const live = (entry: InternalEntry) => entries.get(entry.task.key) === entry && current(entry.task);
  const authorized = (entry: InternalEntry) => {
    if (!live(entry)) return false;
    try { return entry.task.validate() === true && live(entry); }
    catch { return false; }
  };
  const fail = (entry: InternalEntry, error: string) => {
    if (!live(entry)) { discardOtherSessions(); return; }
    cancelTimer(entry);
    entry.state.status = "failed";
    entry.state.error = error;
    emit("failed", entry);
  };
  const armExpiry = (entry: InternalEntry) => {
    cancelTimer(entry);
    entry.timer = options.setTimer(() => {
      entry.timer = undefined;
      discardOtherSessions();
      if (!live(entry) || entry.state.status !== "pending") return;
      if (options.clock() >= entry.state.deadline) fail(entry, "Waiting to save timed out. Retry when ready.");
      else armExpiry(entry); // Timers may fire early; elapsed wall-clock time decides expiry.
    }, Math.max(0, entry.state.deadline - options.clock()));
  };
  const finish = (entry: InternalEntry, acknowledged: unknown, error?: string) => {
    discardOtherSessions();
    if (!live(entry) || entry.state.status !== "saving") return;
    if (acknowledged !== true) { fail(entry, error || "The save was not confirmed. Retry when ready."); return; }
    cancelTimer(entry);
    entry.state.status = "completed";
    entries.delete(entry.task.key);
    entry.completed = true;
    emit("completed", entry);
  };
  const attempt = (entry: InternalEntry) => {
    discardOtherSessions();
    if (!live(entry) || entry.state.status !== "pending") return;
    if (options.clock() >= entry.state.deadline) { fail(entry, "Waiting to save timed out. Retry when ready."); return; }
    if (!authorized(entry)) { fail(entry, "Access changed. This save cannot run."); return; }
    if (!options.isOnline()) return;
    cancelTimer(entry);
    entry.state.status = "saving";
    emit("saving", entry);
    // onChange is allowed to reset the queue or change permissions.
    if (!authorized(entry)) { fail(entry, "Access changed. This save cannot run."); return; }
    if (options.clock() >= entry.state.deadline) { fail(entry, "Waiting to save timed out. Retry when ready."); return; }
    if (!options.isOnline()) {
      entry.state.status = "pending";
      armExpiry(entry);
      emit("queued", entry);
      return;
    }
    try {
      const result = entry.task.execute();
      if (result && typeof (result as Promise<boolean>).then === "function") {
        Promise.resolve(result).then(
          confirmed => finish(entry, confirmed),
          error => finish(entry, false, error instanceof Error ? error.message : "The save was not confirmed. Retry when ready."),
        );
      } else finish(entry, result);
    } catch (error) {
      finish(entry, false, error instanceof Error ? error.message : "The save was not confirmed. Retry when ready.");
    }
  };
  const resultOf = (entry: InternalEntry, accepted: boolean): SaveResult => ({
    accepted,
    key: entry.task.key,
    status: entries.get(entry.task.key) === entry ? entry.state.status : entry.completed ? "completed" : "rejected",
  });
  const enqueue = (task: SaveTask): SaveResult => {
    discardOtherSessions();
    const duplicate = entries.get(task.key);
    if (duplicate) return resultOf(duplicate, false);
    if (!task.key || !task.actor || !current(task)) return { accepted: false, key: task.key, status: "rejected" };
    // Freeze the captured identity and closures against caller object changes.
    const captured = { ...task };
    const now = options.clock();
    const entry: InternalEntry = {
      task: captured,
      state: { key: task.key, id: task.id, label: task.label, actor: task.actor, session: task.session, status: "pending", enqueuedAt: now, deadline: now + SAVE_WAIT_MS },
    };
    entries.set(task.key, entry);
    if (!authorized(entry)) { fail(entry, "Access changed. This save cannot run."); return resultOf(entry, true); }
    armExpiry(entry);
    emit("queued", entry);
    attempt(entry);
    return resultOf(entry, true);
  };
  const retry = (key: string): SaveResult => {
    expire();
    const entry = entries.get(key);
    if (!entry) return { accepted: false, key, status: "rejected" };
    if (entry.state.status !== "failed" || !authorized(entry)) return resultOf(entry, false);
    const now = options.clock();
    entry.state = { ...entry.state, status: "pending", enqueuedAt: now, deadline: now + SAVE_WAIT_MS, error: undefined };
    armExpiry(entry);
    emit("queued", entry);
    attempt(entry);
    return resultOf(entry, true);
  };
  const expire = () => {
    discardOtherSessions();
    for (const entry of [...entries.values()]) {
      if (entry.state.status === "pending" && options.clock() >= entry.state.deadline) fail(entry, "Waiting to save timed out. Retry when ready.");
    }
  };
  const reconnect = () => {
    expire();
    for (const entry of [...entries.values()]) attempt(entry);
  };
  const discard = (key: string) => {
    const entry = entries.get(key);
    if (!entry) return;
    cancelTimer(entry);
    entries.delete(key);
    emit("reset");
  };
  return { enqueue, retry, reconnect, expire, reset, discard, snapshot: () => { discardOtherSessions(); return rawSnapshot(); } };
}
