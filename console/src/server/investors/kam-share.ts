/**
 * D121 A (owner ruling 5 Oct 2026, option 2) — THE KAM'S RECORD SHARES, MADE BY THE SHARE SERVICE (ACCESS-PLAN §4.2, §7 R3).
 *
 * When Contacts.KAM is set or changed, the background "share service" user (D53 service credential "kam-share": background
 * only, never a screen) shares with the new KAM, read/write:
 *   - the Contact,
 *   - its allotments (LLP_UnitAllocation_Module where Customer = the Contact),
 *   - the Touches of its origin lead (Touches.Lead = Contacts.Origin_Lead), so the KAM sees lead-to-investor history.
 * Receipts are never shared with a KAM (money is Finance-only). The old KAM's shares on the same records are revoked —
 * except where the old KAM is the record's owner or the Contact's Originating_IR (the IR's hand-off share is never revoked).
 * IR Manager and Digital Infrastructure keep a manual Share in Zoho for cover windows and fixes (spec.json, D120 note).
 *
 * How a share is written: the record's share list is read (GET .../actions/share), the wanted list is computed from it
 * (every entry kept except the revoked user; the KAM added or raised to read_write) and, only when it differs, written
 * whole (PUT, Zoho revokes whoever is left out; an empty list is DELETE). Re-running is a no-op. Zoho's DELETE revokes
 * EVERY share on a record, so a per-user revoke is never a DELETE while somebody else still holds a share.
 *
 * Refusal: the Contact is read first and must name `toKam` as KAM ("stale" otherwise) — the share never goes to somebody
 * the record does not name; on a pool return (toKam null) a Contact whose KAM is still `fromKam` is stale too.
 *
 * Logging: nothing here logs. The client's Plane B line holds job, record ids and status; the result carries module, id
 * and a status code only — no field value, no name.
 */

import type { RecordShare, ServiceCredential, ShareEntry, ZohoServiceClient } from "../../lib/zoho/client";
import { assertServiceCredential, MAX_RECORD_SHARES } from "../../lib/zoho/client";

export const KAM_SHARE_MODULES = Object.freeze({ contacts: "Contacts", allotments: "LLP_UnitAllocation_Module", touches: "Touches" } as const);
export type KamShareModule = (typeof KAM_SHARE_MODULES)[keyof typeof KAM_SHARE_MODULES];
const RECORD_ID = /^\d{15,22}$/;
const PAGE = 200;
const MAX_PAGES = 10;

export type KamShareClient = Pick<ZohoServiceClient, "coql" | "shares" | "setShares">;

export interface KamShareTask {
  readonly contactId: string;
  /** The KAM the Contact now names, or null when the account went back to the pool (revoke only). */
  readonly toKam: string | null;
  /** The KAM it had before, whose shares are revoked; null when there was none. */
  readonly fromKam: string | null;
}

export type RecordShareStatus = "shared" | "revoked" | "updated" | "unchanged" | "failed";
export interface RecordShareOutcome {
  readonly module: KamShareModule;
  readonly id: string;
  readonly status: RecordShareStatus;
}

export type KamShareResult =
  | {
    readonly ok: true;
    readonly outcomes: readonly RecordShareOutcome[];
    /** false when `shouldStop` cut the run short; the rest is done by a re-run (idempotent). */
    readonly complete: boolean;
  }
  | { readonly ok: false; readonly reason: "invalid-request" | "read-failed" | "stale" };

export interface RunOptions {
  /** Checked before each record's share call; true stops the run (the request deadline's stop margin). */
  readonly shouldStop?: () => boolean;
  readonly signal?: AbortSignal;
}

/** One record and what it should look like. Pure input to `wantedShares`. */
export interface SharePolicy {
  readonly ownerId: string | null;
  /** Gets read_write unless they own the record. */
  readonly kam: string | null;
  /** Users whose share on this record is removed (never the owner, the kept IR or the KAM). */
  readonly revoke: ReadonlySet<string>;
  /** Users whose share is never removed by this job (the Originating_IR). */
  readonly keep: ReadonlySet<string>;
  /** Users given read_only when missing (reconcile restores the IR's hand-off read on the Contact and its allotments). */
  readonly ensureRead?: ReadonlySet<string>;
}

const idOf = (v: unknown): string | null => {
  const x = v && typeof v === "object" ? (v as { id?: unknown }).id : v;
  return typeof x === "string" && RECORD_ID.test(x) ? x : null;
};

const key = (s: ShareEntry) => `${s.kind}:${s.targetId}`;

/**
 * The record's wanted share list from the current one, or null when nothing changes. Every current entry is kept
 * (inherited ones too: re-stating an access the user already has is safer than dropping a share by mistake) except
 * a revoked user's; the KAM is added, or raised to read_write; `ensureRead` users are added read_only when missing.
 */
export function wantedShares(current: readonly RecordShare[], p: SharePolicy): { readonly list: readonly ShareEntry[]; readonly added: boolean; readonly removed: boolean } | null {
  const out = new Map<string, ShareEntry>();
  let removed = false, added = false;
  for (const s of current) {
    const user = s.kind === "users" ? s.targetId : null;
    if (user && p.revoke.has(user) && user !== p.ownerId && !p.keep.has(user) && user !== p.kam) { removed = true; continue; }
    const k = key(s);
    const prev = out.get(k);
    if (!prev || rank(s.permission) > rank(prev.permission)) out.set(k, { kind: s.kind, targetId: s.targetId, permission: s.permission });
  }
  if (p.kam && p.kam !== p.ownerId) {
    const k = `users:${p.kam}`;
    const prev = out.get(k);
    if (!prev || rank(prev.permission) < rank("read_write")) { out.set(k, { kind: "users", targetId: p.kam, permission: "read_write" }); added = true; }
  }
  for (const u of p.ensureRead ?? []) {
    if (u === p.ownerId || out.has(`users:${u}`)) continue;
    out.set(`users:${u}`, { kind: "users", targetId: u, permission: "read_only" });
    added = true;
  }
  if (!added && !removed) return null;
  return { list: Object.freeze([...out.values()].map((x) => Object.freeze(x))), added, removed };
}
const rank = (p: ShareEntry["permission"]) => (p === "full_access" ? 3 : p === "read_write" ? 2 : 1);

/**
 * One record: read its shares, write the wanted list when it differs. Never throws. With `serviceUserId`, a share Zoho
 * says somebody else made (a manual cover-window or fix share by IR Manager / Digital Infrastructure) is never revoked.
 */
export async function syncRecord(client: KamShareClient, as: ServiceCredential, module: KamShareModule, id: string, p: SharePolicy,
  signal?: AbortSignal, serviceUserId: string | null = null): Promise<RecordShareOutcome> {
  const fail = Object.freeze({ module, id, status: "failed" as const });
  try {
    const cur = await client.shares(as, module, id, { signal });
    if (!cur.ok) return fail;
    const manual = serviceUserId
      ? cur.value.filter((s) => s.kind === "users" && s.sharedBy !== null && s.sharedBy !== serviceUserId).map((s) => s.targetId) : [];
    const want = wantedShares(cur.value, manual.length ? { ...p, keep: new Set([...p.keep, ...manual]) } : p);
    if (!want) return Object.freeze({ module, id, status: "unchanged" as const });
    if (want.list.length > MAX_RECORD_SHARES) return fail;
    const w = await client.setShares(as, module, id, want.list, { signal });
    if (!w.ok) return fail;
    return Object.freeze({ module, id, status: want.added && want.removed ? "updated" as const : want.added ? "shared" as const : "revoked" as const });
  } catch { return fail; }
}

interface Row { readonly id: string; readonly ownerId: string | null }

/** COQL over one field = value, id order, paged; ids and owners only. null = could not be read completely. */
async function rowsWhere(client: KamShareClient, as: ServiceCredential, module: string, field: string, value: string, signal?: AbortSignal): Promise<Row[] | null> {
  const out: Row[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const r = await client.coql(as, `select id, Owner from ${module} where ${field} = '${value}' order by id asc limit ${page * PAGE}, ${PAGE}`, { signal });
    if (!r.ok) return null;
    for (const rec of r.value.records) if (RECORD_ID.test(rec.id)) out.push({ id: rec.id, ownerId: idOf(rec.Owner) });
    if (!r.value.moreRecords) return out;
  }
  return null;
}

export interface ContactShareFacts {
  readonly id: string;
  readonly kam: string | null;
  readonly ownerId: string | null;
  readonly originatingIr: string | null;
  readonly originLead: string | null;
}

export async function readContact(client: KamShareClient, as: ServiceCredential, contactId: string, signal?: AbortSignal): Promise<ContactShareFacts | null | "unreadable"> {
  const c = await client.coql(as, `select id, KAM, Owner, Originating_IR, Origin_Lead from ${KAM_SHARE_MODULES.contacts} where id = '${contactId}' limit 0, 1`, { signal });
  if (!c.ok) return "unreadable";
  const rec = c.value.records.find((x) => x.id === contactId);
  if (!rec) return null;
  return { id: contactId, kam: idOf(rec.KAM), ownerId: idOf(rec.Owner), originatingIr: idOf(rec.Originating_IR), originLead: idOf(rec.Origin_Lead) };
}

/** The Contact's records the KAM gets: itself, its allotments, its origin lead's Touches. null = unreadable. */
export async function recordsOf(client: KamShareClient, as: ServiceCredential, c: ContactShareFacts, signal?: AbortSignal)
  : Promise<{ readonly module: KamShareModule; readonly row: Row }[] | null> {
  const allots = await rowsWhere(client, as, KAM_SHARE_MODULES.allotments, "Customer", c.id, signal);
  if (!allots) return null;
  const touches = c.originLead ? await rowsWhere(client, as, KAM_SHARE_MODULES.touches, "Lead", c.originLead, signal) : [];
  if (!touches) return null;
  return [
    { module: KAM_SHARE_MODULES.contacts, row: { id: c.id, ownerId: c.ownerId } },
    ...allots.map((row) => ({ module: KAM_SHARE_MODULES.allotments, row })),
    ...touches.map((row) => ({ module: KAM_SHARE_MODULES.touches, row })),
  ];
}

/**
 * Shares one Contact's records with the KAM it names and revokes the previous KAM's shares on them. A record that fails
 * is reported by id and does not stop the rest; re-running is idempotent (unchanged records are not written).
 */
export async function applyKamShare(client: KamShareClient, as: ServiceCredential, t: KamShareTask, o: RunOptions = {}): Promise<KamShareResult> {
  assertServiceCredential(as, "kam-share");
  if (!t || typeof t.contactId !== "string" || !RECORD_ID.test(t.contactId)) return { ok: false, reason: "invalid-request" };
  if (t.toKam !== null && !RECORD_ID.test(t.toKam)) return { ok: false, reason: "invalid-request" };
  if (t.fromKam !== null && !RECORD_ID.test(t.fromKam)) return { ok: false, reason: "invalid-request" };
  if (t.toKam === null && t.fromKam === null) return { ok: false, reason: "invalid-request" };

  const c = await readContact(client, as, t.contactId, o.signal).catch(() => "unreadable" as const);
  if (c === "unreadable") return { ok: false, reason: "read-failed" };
  if (!c) return { ok: false, reason: "stale" };
  if (t.toKam !== null ? c.kam !== t.toKam : c.kam !== null && c.kam === t.fromKam) return { ok: false, reason: "stale" };

  const records = await recordsOf(client, as, c, o.signal).catch(() => null);
  if (!records) return { ok: false, reason: "read-failed" };
  const keep = new Set(c.originatingIr ? [c.originatingIr] : []);
  const revoke = new Set(t.fromKam && t.fromKam !== t.toKam ? [t.fromKam] : []);
  const outcomes: RecordShareOutcome[] = [];
  for (const { module, row } of records) {
    if (o.shouldStop?.()) return { ok: true, outcomes: Object.freeze(outcomes), complete: false };
    outcomes.push(await syncRecord(client, as, module, row.id, { ownerId: row.ownerId, kam: t.toKam, revoke, keep }, o.signal));
  }
  return { ok: true, outcomes: Object.freeze(outcomes), complete: true };
}

/* ---------------------------------------------------------------- the nightly reconcile (ACCESS-PLAN §7 R3) ---- */

export interface ReconcileSummary {
  readonly contactsChecked: number;
  readonly recordsChecked: number;
  readonly added: readonly string[];
  readonly revoked: readonly string[];
  readonly failed: readonly string[];
  /** Contacts not checked because a read failed (ids). */
  readonly unreadable: readonly string[];
  /** The first Contact id not checked when `shouldStop` cut the run short; null = done. */
  readonly continueFrom: string | null;
}

export interface ReconcileOptions extends RunOptions {
  /** Resume from this Contact id (inclusive), the previous run's `continueFrom`. */
  readonly from?: string | null;
  /** The share-service user's id: a share Zoho says somebody else made (a manual cover-window or fix share) is kept. */
  readonly serviceUserId?: string | null;
  /** At most this many Contacts read (default 2,000). */
  readonly maxContacts?: number;
}

/**
 * For every Contact with KAM set: the Contact and its allotments must carry KAM read_write and Originating_IR read; its
 * origin lead's Touches KAM read_write. Missing shares are added; a share to another KAM (any user who is KAM of some
 * Contact) is revoked unless that user owns the record, is its Originating_IR, or Zoho says a person made it by hand.
 */
export async function reconcileKamShares(client: KamShareClient, as: ServiceCredential, o: ReconcileOptions = {}): Promise<ReconcileSummary | null> {
  assertServiceCredential(as, "kam-share");
  const max = o.maxContacts ?? 2_000;
  const contacts: ContactShareFacts[] = [];
  const from = o.from && RECORD_ID.test(o.from) ? o.from : null;
  for (let offset = 0; contacts.length < max; offset += PAGE) {
    const where = from ? `KAM is not null and id >= '${from}'` : "KAM is not null";
    const r = await client.coql(as, `select id, KAM, Owner, Originating_IR, Origin_Lead from ${KAM_SHARE_MODULES.contacts} where ${where} order by id asc limit ${offset}, ${PAGE}`, { signal: o.signal });
    if (!r.ok) return null;
    for (const rec of r.value.records) {
      const kam = idOf(rec.KAM);
      if (RECORD_ID.test(rec.id) && kam) contacts.push({ id: rec.id, kam, ownerId: idOf(rec.Owner), originatingIr: idOf(rec.Originating_IR), originLead: idOf(rec.Origin_Lead) });
    }
    if (!r.value.moreRecords) break;
  }
  const kams = new Set(contacts.map((c) => c.kam!));
  const added: string[] = [], revoked: string[] = [], failed: string[] = [], unreadable: string[] = [];
  let recordsChecked = 0, contactsChecked = 0;
  for (const c of contacts) {
    if (o.shouldStop?.()) return summary(c.id);
    const records = await recordsOf(client, as, c, o.signal).catch(() => null);
    if (!records) { unreadable.push(c.id); continue; }
    contactsChecked++;
    const keep = new Set(c.originatingIr ? [c.originatingIr] : []);
    for (const { module, row } of records) {
      recordsChecked++;
      const ensureRead = module !== KAM_SHARE_MODULES.touches && c.originatingIr ? new Set([c.originatingIr]) : undefined;
      const outcome = await syncRecord(client, as, module, row.id, { ownerId: row.ownerId, kam: c.kam, revoke: kams, keep, ensureRead }, o.signal, o.serviceUserId ?? null);
      if (outcome.status === "failed") failed.push(row.id);
      if (outcome.status === "shared" || outcome.status === "updated") added.push(row.id);
      if (outcome.status === "revoked" || outcome.status === "updated") revoked.push(row.id);
    }
  }
  return summary(null);

  function summary(continueFrom: string | null): ReconcileSummary {
    return Object.freeze({ contactsChecked, recordsChecked, added: Object.freeze(added), revoked: Object.freeze(revoked), failed: Object.freeze(failed), unreadable: Object.freeze(unreadable), continueFrom });
  }
}
