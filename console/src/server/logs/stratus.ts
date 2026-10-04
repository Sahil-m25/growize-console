/**
 * THE STRATUS ADAPTER FOR PLANES B AND C, AND FOR THE AUDIT ARCHIVE (docs/architecture/log-sink.md).
 *
 * Zoho Catalyst AppSail gives each instance an ephemeral disk, so on AppSail the day files would vanish with
 * the instance. Catalyst Stratus (object storage, India buckets on *.zohostratus.in) is the durable sink:
 *
 *   growize-logs/<plane>/<day>/<instance>/<seq>.jsonl          one segment: the lines one instance buffered
 *   growize-logs/<plane>/<day>/<instance>/<seq>.manifest.json  its manifest: line count, sha256 of the segment,
 *                                                              first/last chain hash, the previous segment's last
 *   growize-audit/<day>.jsonl + <day>.seal.json                the audit archive (Plane A), one sealed object a day
 *
 * A segment is cut every LOG_FLUSH_LINES lines or LOG_FLUSH_SECONDS seconds, whichever comes first, and on
 * flush(). Objects are written once under a fresh key and never rewritten (no `overwrite` header). Reading a
 * day lists its prefix, fetches each manifest and segment, and drops a segment whose bytes no longer match its
 * manifest (the verifier reports it). This instance's unflushed lines are included in its own reads.
 *
 * REST shapes, from the Catalyst API reference (https://docs.catalyst.zoho.com/en/api/code-reference/cloud-scale/stratus/llms-full.md):
 *   Upload    PUT  https://<bucket>.zohostratus.in/<key>   Authorization: Zoho-oauthtoken …   scope Stratus.fileop.CREATE
 *   Download  GET  https://<bucket>.zohostratus.in/<key>   Authorization: Zoho-oauthtoken …
 *   List      GET  {api-domain}/baas/v1/project/{project_id}/bucket/objects?bucket_name=&prefix=&max_keys=&continuation_token=
 *             → { status, data: { truncated, next_continuation_token, contents: [{ key, version_id, etag, size, … }] } }
 *             scope ZohoCatalyst.buckets.objects.READ
 * Bucket URLs per data centre (India: .zohostratus.in; development buckets add "-development"):
 *   https://docs.catalyst.zoho.com/en/cloud-scale/help/stratus/llms-full.md
 * Overwrite and versioning: https://docs.catalyst.zoho.com/en/sdk/nodejs/v2/cloud-scale/stratus/upload-object
 *
 * UNVERIFIED until the Catalyst spike runs against a real bucket (each is listed in log-sink.md):
 *   - the list path: the reference lists `/bucket/objects` but its own sample URL reads `/buckets/objects`
 *   - that a PUT without `overwrite` to an existing key is refused on a non-versioned bucket
 *   - the `Environment: Development` header for development buckets on the list call
 *   - that a Catalyst self-client refresh token with the two scopes above works from AppSail
 *   - the response shape of an error (we read only the status code)
 */

import { createHash, randomBytes } from "node:crypto";
import type { ArchivedAuditRow, AuditArchive } from "../activity/archive";
import type { SegmentManifest, StoredSegment } from "./chain";
import { dayOf, MAX_LINE_BYTES } from "./jsonl";
import type { PlaneStore } from "./sink";

/* ---- configuration (fails closed) --------------------------------------------------------------- */

export interface StratusConfig {
  readonly bucketUrl: string;
  readonly bucketName: string;
  readonly development: boolean;
  readonly apiDomain: string;
  readonly projectId: string;
  readonly accountsOrigin: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly refreshToken: string;
  readonly instance: string;
  readonly flushLines: number;
  readonly flushMs: number;
}

const BUCKET_URL = /^https:\/\/([a-z0-9][a-z0-9-]{1,62})\.zohostratus\.in\/?$/;
const API_DOMAIN = /^https:\/\/api\.catalyst\.zoho\.in$/;
const ACCOUNTS = /^https:\/\/accounts\.zoho\.in$/;
const INSTANCE = /^[a-z0-9][a-z0-9-]{0,31}$/;
const SECRET = /^[^\s\0]{8,4096}$/;

const intIn = (raw: string | undefined, lo: number, hi: number, dflt: number, name: string, bad: string[]): number => {
  if (raw === undefined || raw.trim() === "") return dflt;
  const v = Number(raw);
  if (!Number.isInteger(v) || v < lo || v > hi) { bad.push(`${name} (${lo}–${hi})`); return dflt; }
  return v;
};

/**
 * LOG_SINK=stratus's settings, or a thrown Error naming every missing or malformed variable (never a value).
 * India only: the bucket must be on .zohostratus.in and the API on api.catalyst.zoho.in (DPDP, D47).
 */
export function stratusConfig(env: NodeJS.ProcessEnv): StratusConfig {
  const missing: string[] = [];
  const bad: string[] = [];
  const need = (name: string, re: RegExp, dflt?: string): string => {
    const v = (env[name] ?? "").trim() || dflt || "";
    if (!v) missing.push(name); else if (!re.test(v)) bad.push(name);
    return v;
  };
  const bucketUrl = need("STRATUS_BUCKET_URL", BUCKET_URL).replace(/\/$/, "");
  const projectId = need("CATALYST_PROJECT_ID", /^\d{6,25}$/);
  const apiDomain = need("CATALYST_API_DOMAIN", API_DOMAIN, "https://api.catalyst.zoho.in");
  const accountsOrigin = need("STRATUS_ACCOUNTS_ORIGIN", ACCOUNTS, "https://accounts.zoho.in");
  const clientId = need("STRATUS_CLIENT_ID", SECRET);
  const clientSecret = need("STRATUS_CLIENT_SECRET", SECRET);
  const refreshToken = need("STRATUS_REFRESH_TOKEN", SECRET);
  const rawInstance = (env.LOG_INSTANCE_ID ?? "").trim();
  if (rawInstance && !INSTANCE.test(rawInstance)) bad.push("LOG_INSTANCE_ID");
  const flushLines = intIn(env.LOG_FLUSH_LINES, 10, 5_000, 500, "LOG_FLUSH_LINES", bad);
  const flushMs = intIn(env.LOG_FLUSH_SECONDS, 5, 300, 30, "LOG_FLUSH_SECONDS", bad) * 1_000;
  if (missing.length || bad.length) {
    throw new Error(`LOG_SINK=stratus is misconfigured — ${[missing.length ? `missing: ${missing.join(", ")}` : "", bad.length ? `malformed: ${bad.join(", ")}` : ""].filter(Boolean).join("; ")}. Nothing is logged until this is fixed.`);
  }
  const host = BUCKET_URL.exec(bucketUrl)![1]!;
  const development = host.endsWith("-development");
  return Object.freeze({
    bucketUrl, bucketName: development ? host.slice(0, -"-development".length) : host, development, apiDomain, projectId,
    accountsOrigin, clientId, clientSecret, refreshToken,
    instance: rawInstance || `i-${randomBytes(6).toString("hex")}`, flushLines, flushMs,
  });
}

/* ---- HTTP: the token and the three calls -------------------------------------------------------- */

export interface StratusResponse { readonly status: number; text(): Promise<string> }
export type StratusFetch = (url: string, init: { readonly method: "GET" | "PUT" | "POST"; readonly headers: Readonly<Record<string, string>>; readonly body?: string }) => Promise<StratusResponse>;

export interface TokenSource { token(): Promise<string>; invalidate(): void }

/** A Catalyst self-client's refresh token → an access token, cached to five minutes before expiry. Nothing is logged. */
export function stratusTokenSource(c: Pick<StratusConfig, "accountsOrigin" | "clientId" | "clientSecret" | "refreshToken">, fetchImpl: StratusFetch, clock: () => number = Date.now): TokenSource {
  let cached: { value: string; until: number } | null = null;
  let pending: Promise<string> | null = null;
  const refresh = async (): Promise<string> => {
    const body = new URLSearchParams({ refresh_token: c.refreshToken, client_id: c.clientId, client_secret: c.clientSecret, grant_type: "refresh_token" }).toString();
    const r = await fetchImpl(`${c.accountsOrigin}/oauth/v2/token`, { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" }, body });
    let j: { access_token?: unknown; expires_in?: unknown } = {};
    try { j = JSON.parse(await r.text()) as typeof j; } catch { /* handled below */ }
    if (r.status < 200 || r.status >= 300 || typeof j.access_token !== "string" || !j.access_token) throw new Error("stratus-token-refused");
    const life = typeof j.expires_in === "number" && j.expires_in > 0 ? j.expires_in * 1_000 : 3_600_000;
    cached = { value: j.access_token, until: clock() + life - 5 * 60_000 };
    return j.access_token;
  };
  return Object.freeze({
    async token() {
      if (cached && clock() < cached.until) return cached.value;
      pending ??= refresh().finally(() => { pending = null; });
      return pending;
    },
    invalidate() { cached = null; },
  });
}

export interface StratusObject { readonly key: string; readonly version: string | null }
export interface StratusClient {
  put(key: string, body: string, contentType: string): Promise<void>;
  /** null when the object does not exist. */
  get(key: string): Promise<string | null>;
  list(prefix: string): Promise<readonly StratusObject[]>;
}

const KEY = /^[a-z0-9][a-z0-9/._-]{0,500}$/;
const MAX_LIST_PAGES = 200;

export function createStratusClient(c: Pick<StratusConfig, "bucketUrl" | "bucketName" | "development" | "apiDomain" | "projectId">, tokens: TokenSource, fetchImpl: StratusFetch): StratusClient {
  const call = async (method: "GET" | "PUT", url: string, extra: Record<string, string>, body?: string): Promise<StratusResponse> => {
    for (let attempt = 0; ; attempt++) {
      const headers = { Authorization: `Zoho-oauthtoken ${await tokens.token()}`, ...(c.development ? { Environment: "Development" } : {}), ...extra };
      const r = await fetchImpl(url, { method, headers, ...(body !== undefined ? { body } : {}) });
      if (r.status === 401 && attempt === 0) { tokens.invalidate(); continue; }
      return r;
    }
  };
  const checkKey = (k: string) => { if (!KEY.test(k) || k.includes("..")) throw new Error("stratus-bad-key"); return k; };
  return Object.freeze({
    async put(key: string, body: string, contentType: string) {
      const r = await call("PUT", `${c.bucketUrl}/${checkKey(key)}`, { "Content-Type": contentType, "Content-Length": String(Buffer.byteLength(body, "utf8")) }, body);
      if (r.status < 200 || r.status >= 300) throw new Error(`stratus-put-${r.status}`);
    },
    async get(key: string) {
      const r = await call("GET", `${c.bucketUrl}/${checkKey(key)}`, {});
      if (r.status === 404) return null;
      if (r.status < 200 || r.status >= 300) throw new Error(`stratus-get-${r.status}`);
      return r.text();
    },
    async list(prefix: string) {
      const out: StratusObject[] = [];
      let token: string | null = null;
      for (let page = 0; page < MAX_LIST_PAGES; page++) {
        const q = new URLSearchParams({ bucket_name: c.bucketName, prefix: checkKey(prefix), max_keys: "1000" });
        if (token) q.set("continuation_token", token);
        const r = await call("GET", `${c.apiDomain}/baas/v1/project/${c.projectId}/bucket/objects?${q}`, { Accept: "application/json" });
        if (r.status === 404) return out;
        if (r.status < 200 || r.status >= 300) throw new Error(`stratus-list-${r.status}`);
        let j: { data?: { truncated?: unknown; next_continuation_token?: unknown; contents?: unknown } } = {};
        try { j = JSON.parse(await r.text()) as typeof j; } catch { throw new Error("stratus-list-unreadable"); }
        const items = Array.isArray(j.data?.contents) ? (j.data!.contents as unknown[]) : [];
        for (const it of items) {
          const o = (it ?? {}) as { key?: unknown; version_id?: unknown; etag?: unknown };
          if (typeof o.key === "string" && KEY.test(o.key)) {
            out.push({ key: o.key, version: typeof o.version_id === "string" ? o.version_id : typeof o.etag === "string" ? o.etag : null });
          }
        }
        token = j.data?.truncated === true && typeof j.data.next_continuation_token === "string" ? j.data.next_continuation_token : null;
        if (!token) return out;
      }
      throw new Error("stratus-list-too-long");
    },
  });
}

/* ---- Planes B and C as segment objects ---------------------------------------------------------- */

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const LOG_PREFIX = "growize-logs";
const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const pad = (n: number) => String(n).padStart(6, "0");
const SEGMENT_KEY = /^growize-logs\/[a-z-]+\/\d{4}-\d{2}-\d{2}\/([a-z0-9][a-z0-9-]{0,31})\/(\d{6})\.(jsonl|manifest\.json)$/;

const parseLines = (text: string): unknown[] => {
  const out: unknown[] = [];
  for (const line of text.split("\n")) { if (!line) continue; try { out.push(JSON.parse(line)); } catch { /* a torn line is skipped */ } }
  return out;
};

const manifestOf = (text: string | null): SegmentManifest | null => {
  if (!text) return null;
  try {
    const m = JSON.parse(text) as Record<string, unknown>;
    const h = (x: unknown) => x === null || (typeof x === "string" && /^[0-9a-f]{64}$/.test(x));
    return m.v === 1 && typeof m.plane === "string" && typeof m.day === "string" && DAY.test(m.day) && typeof m.instance === "string"
      && Number.isSafeInteger(m.seq) && Number.isSafeInteger(m.lines) && typeof m.sha256 === "string" && /^[0-9a-f]{64}$/.test(m.sha256)
      && h(m.first) && h(m.last) && h(m.prevLast) && typeof m.at === "number" ? (m as unknown as SegmentManifest) : null;
  } catch { return null; }
};

export interface StratusPlaneStoreOptions {
  readonly client: StratusClient;
  readonly plane: string;
  readonly instance: string;
  readonly clock?: () => number;
  readonly flushLines?: number;
  readonly flushMs?: number;
  /** Lines held while uploads fail; past it append throws (the log writer reports it, the request goes on). */
  readonly maxPending?: number;
  /** A failed upload (the lines stay buffered and are retried on the next flush). */
  readonly onError?: (code: string) => void;
  /** false in tests that drive flush() themselves. */
  readonly timer?: boolean;
}

export interface StratusPlaneStore extends PlaneStore {
  /** Lines accepted and not yet uploaded. */
  pending(): number;
  /** Stop the flush timer (tests, shutdown). */
  close(): void;
}

export function createStratusPlaneStore(o: StratusPlaneStoreOptions): StratusPlaneStore {
  if (!/^[a-z][a-z0-9-]{0,31}$/.test(o.plane) || !INSTANCE.test(o.instance)) throw new Error("A Stratus log store needs a plane code and an instance id.");
  const clock = o.clock ?? Date.now;
  const flushLines = o.flushLines ?? 500;
  const maxPending = o.maxPending ?? 20_000;
  const buffer = new Map<string, string[]>(); // day → lines not yet cut into a segment
  const unsent: { day: string; seq: number; body: string; manifest: SegmentManifest | null; segmentDone: boolean }[] = [];
  const nextSeq = new Map<string, number>();
  const lastHash = new Map<string, string | null>();
  const cache = new Map<string, readonly unknown[]>(); // `${key}@${version}` → lines of a sealed, verified segment
  let queued = 0;
  let chain: Promise<void> = Promise.resolve();
  const prefix = (day: string) => `${LOG_PREFIX}/${o.plane}/${day}/`;
  const keyOf = (day: string, seq: number, kind: "jsonl" | "manifest.json") => `${prefix(day)}${o.instance}/${pad(seq)}.${kind}`;

  /** Cut every buffered day into a segment (in order), then upload whatever is not yet uploaded. */
  const drain = async (): Promise<void> => {
    for (const [day, lines] of buffer) {
      if (!lines.length) continue;
      buffer.set(day, []);
      const seq = nextSeq.get(day) ?? 0;
      nextSeq.set(day, seq + 1);
      const body = lines.join("");
      const parsed = parseLines(body) as { h?: unknown }[];
      const hOf = (x: { h?: unknown } | undefined) => (typeof x?.h === "string" ? x.h : null);
      const manifest: SegmentManifest = Object.freeze({
        v: 1, plane: o.plane, day, instance: o.instance, seq, lines: parsed.length, sha256: sha256(body),
        first: hOf(parsed[0]), last: hOf(parsed[parsed.length - 1]), prevLast: seq === 0 ? null : lastHash.get(day) ?? null, at: clock(),
      });
      lastHash.set(day, manifest.last);
      unsent.push({ day, seq, body, manifest, segmentDone: false });
    }
    while (unsent.length) {
      const u = unsent[0]!;
      try {
        if (!u.segmentDone) { await o.client.put(keyOf(u.day, u.seq, "jsonl"), u.body, "application/x-ndjson"); u.segmentDone = true; }
        await o.client.put(keyOf(u.day, u.seq, "manifest.json"), JSON.stringify(u.manifest), "application/json");
      } catch (e) {
        try { o.onError?.(e instanceof Error && /^stratus-[a-z0-9-]+$/.test(e.message) ? e.message : "stratus-upload-failed"); } catch { /* never throws */ }
        return; // kept in order; the next flush retries from here
      }
      unsent.shift();
      queued -= u.manifest?.lines ?? 0;
    }
  };
  const flush = (): Promise<void> => (chain = chain.then(drain, drain));

  const timer = o.timer === false ? null : setInterval(() => { void flush(); }, o.flushMs ?? 30_000);
  (timer as { unref?: () => void } | null)?.unref?.();

  const segments = async (day: string): Promise<readonly StoredSegment[]> => {
    if (!DAY.test(day)) return [];
    const objects = await o.client.list(prefix(day));
    const byInstanceSeq = new Map<string, { data?: StratusObject; manifest?: StratusObject; instance: string; seq: number }>();
    for (const ob of objects) {
      const m = SEGMENT_KEY.exec(ob.key);
      if (!m || !ob.key.startsWith(prefix(day))) continue;
      const id = `${m[1]}/${m[2]}`;
      const slot = byInstanceSeq.get(id) ?? { instance: m[1]!, seq: Number(m[2]) };
      if (m[3] === "jsonl") slot.data = ob; else slot.manifest = ob;
      byInstanceSeq.set(id, slot);
    }
    const slots = [...byInstanceSeq.values()].sort((a, b) => (a.instance < b.instance ? -1 : a.instance > b.instance ? 1 : a.seq - b.seq));
    const out: StoredSegment[] = [];
    for (const s of slots) {
      const manifest = s.manifest ? manifestOf(await o.client.get(s.manifest.key)) : null;
      const key = s.data?.key ?? s.manifest!.key;
      if (!s.data) { out.push(Object.freeze({ key, manifest, lines: Object.freeze([]), problem: "unreadable" as const })); continue; }
      const ck = `${s.data.key}@${s.data.version ?? ""}@${manifest?.sha256 ?? ""}`;
      const hit = manifest ? cache.get(ck) : undefined;
      if (hit) { out.push(Object.freeze({ key, manifest, lines: hit, problem: null })); continue; }
      const body = await o.client.get(s.data.key);
      if (body === null) { out.push(Object.freeze({ key, manifest, lines: Object.freeze([]), problem: "unreadable" as const })); continue; }
      if (!manifest) { out.push(Object.freeze({ key, manifest: null, lines: Object.freeze(parseLines(body)), problem: "unsealed" as const })); continue; }
      if (sha256(body) !== manifest.sha256) { out.push(Object.freeze({ key, manifest, lines: Object.freeze([]), problem: "segment-edited" as const })); continue; }
      const lines = Object.freeze(parseLines(body));
      if (cache.size > 5_000) cache.clear();
      cache.set(ck, lines);
      out.push(Object.freeze({ key, manifest, lines, problem: null }));
    }
    return out;
  };

  return Object.freeze({
    plane: o.plane,
    append(record: object): void {
      const line = JSON.stringify(record) + "\n";
      if (Buffer.byteLength(line, "utf8") > MAX_LINE_BYTES) throw new RangeError(`A ${o.plane} log line is over ${MAX_LINE_BYTES} bytes.`);
      if (queued >= maxPending) throw new Error(`The ${o.plane} log buffer is full: Stratus has not taken a segment.`);
      const day = dayOf(clock());
      const b = buffer.get(day) ?? [];
      b.push(line);
      buffer.set(day, b);
      queued++;
      if (b.length >= flushLines) void flush();
    },
    async days() {
      const objects = await o.client.list(`${LOG_PREFIX}/${o.plane}/`);
      const days = new Set<string>();
      for (const ob of objects) { const d = ob.key.split("/")[2]; if (d && DAY.test(d)) days.add(d); }
      for (const [d, l] of buffer) if (l.length) days.add(d);
      for (const u of unsent) days.add(u.day);
      return Object.freeze([...days].sort());
    },
    async read(day: string) {
      const out: unknown[] = [];
      const segs = await segments(day);
      for (const s of segs) out.push(...s.lines);
      /* this instance's lines not yet uploaded (a segment not listed yet, then the open buffer) */
      const listed = new Set(segs.map((s) => s.key));
      for (const u of unsent) if (u.day === day && !listed.has(keyOf(u.day, u.seq, "jsonl"))) out.push(...parseLines(u.body));
      out.push(...parseLines((buffer.get(day) ?? []).join("")));
      return Object.freeze(out);
    },
    segments,
    flush,
    pending: () => queued,
    close: () => { if (timer) clearInterval(timer); },
  });
}

/* ---- the audit archive (Plane A's nightly export) on Stratus ------------------------------------ */

const AUDIT_PREFIX = "growize-audit";

/**
 * The same contract as the local archive (../activity/archive.ts): a day is written once, as a data object
 * under a fresh key plus a seal naming it with its sha256; reads trust only sealed days and check the hash.
 */
export function createStratusAuditArchive(o: { readonly client: StratusClient; readonly clock?: () => number; readonly clean: (x: unknown) => ArchivedAuditRow | null }): AuditArchive {
  const clock = o.clock ?? Date.now;
  type Seal = { day: string; file: string; rows: number; sha256: string; at: number };
  const sealKey = (day: string) => `${AUDIT_PREFIX}/${day}.seal.json`;
  const sealOf = async (day: string): Promise<Seal | null> => {
    if (!DAY.test(day)) return null;
    const t = await o.client.get(sealKey(day));
    if (!t) return null;
    try {
      const s = JSON.parse(t) as Seal;
      return s.day === day && typeof s.file === "string" && KEY.test(s.file) && s.file.startsWith(`${AUDIT_PREFIX}/${day}-`) && /^[0-9a-f]{64}$/.test(s.sha256) ? s : null;
    } catch { return null; }
  };
  const sealedDays = async (): Promise<string[]> => (await o.client.list(`${AUDIT_PREFIX}/`))
    .map((x) => /^growize-audit\/(\d{4}-\d{2}-\d{2})\.seal\.json$/.exec(x.key)?.[1]).filter((d): d is string => !!d).sort();
  return Object.freeze({
    kind: "stratus" as const,
    async has(day: string) { return !!(await sealOf(day)); },
    async write(day: string, rows: readonly ArchivedAuditRow[]) {
      if (!DAY.test(day)) throw new RangeError("An archive day is YYYY-MM-DD.");
      if (await sealOf(day)) throw new Error(`The audit archive already holds ${day}; it is never rewritten.`);
      const clean = rows.map(o.clean).filter((r): r is ArchivedAuditRow => !!r && r.day === day);
      const body = clean.map((r) => JSON.stringify(r) + "\n").join("");
      const digest = sha256(body);
      const file = `${AUDIT_PREFIX}/${day}-${randomBytes(6).toString("hex")}.jsonl`;
      await o.client.put(file, body, "application/x-ndjson");
      const seal: Seal = { day, file, rows: clean.length, sha256: digest, at: clock() };
      await o.client.put(sealKey(day), JSON.stringify(seal), "application/json");
      return { rows: clean.length, sha256: digest };
    },
    async days() { return sealedDays(); },
    async read(day: string) {
      const s = await sealOf(day);
      if (!s) return [];
      const body = await o.client.get(s.file);
      if (body === null || sha256(body) !== s.sha256) throw new Error("tampered");
      return body.split("\n").filter(Boolean).map((l) => o.clean(JSON.parse(l))).filter((r): r is ArchivedAuditRow => !!r);
    },
    async lastRun() {
      const days = await sealedDays();
      const last = days.length ? await sealOf(days[days.length - 1]!) : null;
      return last ? last.at : null;
    },
  });
}
