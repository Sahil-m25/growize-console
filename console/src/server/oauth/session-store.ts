/**
 * M18-S09-NOTE-1 — THE USER SESSION STORE ON SHARED STATE (docs/architecture/shared-state.md inventory 6).
 *
 * The same records the process-local `createMemorySessionStore` keeps (who, seat, the sealed refresh token,
 * createdAt, expiresAt — nothing more), written to the process's SharedState (server/state) so a session survives
 * an instance being recycled and is the same session on every instance. STATE_STORE picks the backend: memory
 * (default; one process, as before) or catalyst.
 *
 *   sess|<store key>          → the whole record, AES-256-GCM sealed with SESSION_ENC_KEY and bound to its own key
 *                               (a record copied under another key will not open). TTL = what is left of the
 *                               session's 12 hours plus SESSION_TTL_GRACE_S, so the backend forgets it on its own.
 *   sess-n|<who>              → a counter (incr, no expiry): the slots this person has used
 *   sess-ix|<who>|<n>         → slot n: the store key of one of their sessions, same TTL as that session
 *
 * The store key is already sha256(session id) (crypto.ts idHash): the cookie's id never sits in the store, so a dump
 * cannot be replayed as a cookie. The refresh token inside the record is still sealed with ZOHO_SESSION_KEY as before;
 * SESSION_ENC_KEY seals the record as a whole (who, seat and the times are not readable at rest either).
 *
 * keysOf(who) (M03-S04-T01) reads the newest KEYS_OF_SCAN slots. The counter is an atomic incr on every backend, so
 * two sign-ins on two instances never take the same slot. A slot left pointing at a deleted record is harmless:
 * endSessionsOf reads the record and skips what is gone; the slot expires with the session it named.
 *
 * Fails closed: a record that will not open (tampered, another key, another binding, not a session) is treated as
 * no session — the person is signed out — and is released. A backend that cannot answer rejects (SharedStateError);
 * the route fails, nobody is let in. Nothing here logs (rule 7): no key, id or value reaches a log line.
 *
 *   SESSION_ENC_KEY   32 random bytes, base64. Required when STATE_STORE=catalyst (startup refuses without it).
 *                     Under memory it is optional: absent, a random key is made for this process (the records die
 *                     with the process anyway). Must differ from ZOHO_SESSION_KEY.
 */

import { randomBytes } from "node:crypto";
import { createSealer, type Sealer } from "./crypto";
import type { SessionStore, StoredSession } from "./user-session";
import type { SharedState } from "../state/shared-state";

export const SESSION_ENC_KEY_ENV = "SESSION_ENC_KEY";
/** The backend keeps a record this long past the session's end, so the first read after 12 hours still finds it and
 *  ends it properly (the "expired" message, the refresh token revoked at Zoho, the Plane C line). user-session.ts
 *  refuses the session at expiresAt exactly; the grace never lets anyone in. */
export const SESSION_TTL_GRACE_S = 10 * 60;
/** How many of a person's newest sign-ins keysOf looks at (12 hours of sign-ins; more only ends on next read). */
export const KEYS_OF_SCAN = 64;

const RECORD_AAD = "gz-session-v1|";
const recKey = (key: string) => `sess|${key}`;
const countKey = (who: string) => `sess-n|${who}`;
const slotKey = (who: string, n: number) => `sess-ix|${who}|${n}`;

function parse(json: string | null): StoredSession | null {
  if (json === null) return null;
  let r: unknown;
  try { r = JSON.parse(json); } catch { return null; }
  if (!r || typeof r !== "object") return null;
  const o = r as Record<string, unknown>;
  if (typeof o.who !== "string" || typeof o.seat !== "string" || typeof o.sealedRefresh !== "string"
    || typeof o.createdAt !== "number" || typeof o.expiresAt !== "number") return null;
  return Object.freeze({ who: o.who, seat: o.seat, sealedRefresh: o.sealedRefresh, createdAt: o.createdAt, expiresAt: o.expiresAt });
}

export function createSharedSessionStore(state: SharedState, sealer: Sealer, options: { clock?: () => number } = {}): SessionStore {
  const clock = options.clock ?? Date.now;
  const ttlOf = (r: StoredSession): number | null => {
    const s = Math.ceil((r.expiresAt - clock()) / 1_000);
    return s > 0 ? s + SESSION_TTL_GRACE_S : null;
  };
  return Object.freeze({
    async get(key: string): Promise<StoredSession | null> {
      const sealed = await state.get(recKey(key));
      if (sealed === null) return null;
      const rec = parse(sealer.open(sealed, RECORD_AAD + key));
      if (rec === null) {
        /* tampered / another key / not a session: no session, and nothing left behind to try again */
        await state.release(recKey(key));
        return null;
      }
      return rec;
    },
    async put(key: string, record: StoredSession): Promise<void> {
      const ttl = ttlOf(record);
      if (ttl === null) return;   // already over: nothing to keep
      const plain = JSON.stringify({
        who: record.who, seat: record.seat, sealedRefresh: record.sealedRefresh, createdAt: record.createdAt, expiresAt: record.expiresAt,
      });
      await state.set(recKey(key), sealer.seal(plain, RECORD_AAD + key), ttl);
      const n = await state.incr(countKey(record.who));
      await state.set(slotKey(record.who, n), key, ttl);
    },
    async delete(key: string): Promise<void> {
      await state.release(recKey(key));
    },
    async keysOf(who: string): Promise<readonly string[]> {
      const top = Number(await state.get(countKey(who)));
      if (!Number.isSafeInteger(top) || top < 1) return [];
      const out = new Set<string>();
      for (let n = top; n > Math.max(0, top - KEYS_OF_SCAN); n--) {
        const k = await state.get(slotKey(who, n));
        if (k !== null) out.add(k);
      }
      return [...out];
    },
  });
}

/**
 * The record sealer from env. Throws (the server does not start — src/instrumentation.ts) when the store is shared
 * and SESSION_ENC_KEY is missing, when the key is not 32 bytes, or when it equals ZOHO_SESSION_KEY.
 */
export function sessionSealerFromEnv(stateKind: string, env: NodeJS.ProcessEnv = process.env): Sealer {
  const key = (env[SESSION_ENC_KEY_ENV] ?? "").trim();
  if (key === "") {
    if (stateKind !== "memory") throw new Error(`${SESSION_ENC_KEY_ENV} is required when STATE_STORE=${stateKind}: user sessions are encrypted at rest. Refusing to start.`);
    return createSealer(randomBytes(32).toString("base64"));
  }
  if (env.ZOHO_SESSION_KEY && key === env.ZOHO_SESSION_KEY.trim()) throw new Error(`${SESSION_ENC_KEY_ENV} must differ from ZOHO_SESSION_KEY.`);
  try {
    return createSealer(key);
  } catch {
    throw new Error(`${SESSION_ENC_KEY_ENV} must be 32 random bytes, base64-encoded.`);
  }
}

/** Server start: refuse to run with a shared state store and no session key (or a malformed key). */
export function sessionStoreStartupCheck(stateKind: string, env: NodeJS.ProcessEnv = process.env): void {
  sessionSealerFromEnv(stateKind, env);
}
