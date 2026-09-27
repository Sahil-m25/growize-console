/* THE PHASE-1 ZOHO STUB — who "Continue with Zoho" signs in while the real OAuth (phase 2, D53) is
   not wired. Outside fixture mode and outside production only, `ZOHO_STUB_USER="Full Name|email|seat"`
   names ONE person; pressing the button signs them in. They are never written into the code or the
   book: the server adds them to the (empty) dataset it serves for as long as their session lasts.

   seat — a lead seat (ir, conv, ops, exec, bu, corp) or an Investors role (head, fin, comp, audit,
   amlead, kam, di, admin, root; aliases hof = head, amh = amlead, sys = admin). "ops" is Digital
   Infrastructure, which is both sides (the Investors "di" super user), exactly as "di" is; Finance
   Operations on the Investors side is "fin" (its role key "ops" is the lead seat's word). */

import type { Person, PersonKey, SeatKey } from "@/domain";
import type { ImRoleKey } from "@/lib/im";
import { fixtureModeOn } from "@/lib/fixture-mode";
import type { Dataset } from "./types";

export type StubUser = {
  /** the person key the session and the book use */
  key: PersonKey;
  n: string;
  em: string;
  /** the seat token as given, canonical (aliases resolved) — what the session holds */
  seat: string;
  /** the lead-side seat the person holds */
  leadSeat: SeatKey;
  /** the Investors-side role, when they work there */
  imRole: ImRoleKey | null;
  /** a name here and never a lead-side login (an Investors-only seat) */
  ext: boolean;
};

export type StubParse = { ok: true; user: StubUser } | { ok: false; error: string };

const LEAD: Record<string, { leadSeat: SeatKey; imRole: ImRoleKey | null }> = {
  ir: { leadSeat: "ir", imRole: null },
  conv: { leadSeat: "conv", imRole: null },
  ops: { leadSeat: "ops", imRole: "di" },
  exec: { leadSeat: "exec", imRole: null },
  bu: { leadSeat: "bu", imRole: null },
  corp: { leadSeat: "corp", imRole: null },
};
const IM: Record<string, { leadSeat: SeatKey; imRole: ImRoleKey; ext: boolean }> = {
  head: { leadSeat: "fin", imRole: "head", ext: true },
  fin: { leadSeat: "fin", imRole: "ops", ext: true },
  comp: { leadSeat: "fin", imRole: "comp", ext: true },
  audit: { leadSeat: "fin", imRole: "audit", ext: true },
  amlead: { leadSeat: "am", imRole: "amlead", ext: true },
  kam: { leadSeat: "am", imRole: "kam", ext: true },
  di: { leadSeat: "ops", imRole: "di", ext: false },
  admin: { leadSeat: "corp", imRole: "admin", ext: false },
  root: { leadSeat: "corp", imRole: "root", ext: false },
};
const ALIAS: Record<string, string> = { hof: "head", amh: "amlead", sys: "admin" };

export const STUB_SEATS: readonly string[] = [...Object.keys(LEAD), ...Object.keys(IM).filter((k) => !(k in LEAD)), ...Object.keys(ALIAS)];

const EMAIL = /^[^\s@|]+@[^\s@|]+\.[^\s@|]+$/;

/** Parse and validate `ZOHO_STUB_USER`. Never throws. */
export function parseStubUser(raw: string | null | undefined): StubParse {
  if (raw == null || !raw.trim()) return { ok: false, error: "ZOHO_STUB_USER is not set." };
  const parts = raw.split("|").map((s) => s.trim());
  if (parts.length !== 3) return { ok: false, error: "ZOHO_STUB_USER must be \"Full Name|email|seat\"." };
  const [n, em, seat0] = parts as [string, string, string];
  if (!n || n.length > 80 || /[<>]/.test(n)) return { ok: false, error: "ZOHO_STUB_USER needs a full name." };
  if (!EMAIL.test(em)) return { ok: false, error: "ZOHO_STUB_USER needs an email address." };
  const seat = ALIAS[seat0.toLowerCase()] ?? seat0.toLowerCase();
  const l = LEAD[seat], i = IM[seat];
  if (!l && !i) return { ok: false, error: `ZOHO_STUB_USER seat "${seat0}" is not one of ${STUB_SEATS.join(", ")}.` };
  const key = (em.split("@")[0]!.toLowerCase().replace(/[^a-z0-9]/g, "") || "zohouser") as PersonKey;
  const m = l ? { ...l, ext: false } : i!;
  return { ok: true, user: { key, n, em: em.toLowerCase(), seat, leadSeat: m.leadSeat, imRole: m.imRole, ext: m.ext } };
}

/** The stub is honoured only outside fixture mode (the demo list is that mode's door) and never in
 *  a production build — except the separate local TEST build (GZ_LOCAL_BUILD=1, output in
 *  .next-local), which is not a deployment, exactly as `fixtureModeOn` treats it. */
export const stubAllowed = (env: NodeJS.ProcessEnv = process.env): boolean =>
  !fixtureModeOn(env) && (env.NODE_ENV !== "production" || env.GZ_LOCAL_BUILD === "1");

/** The configured stub person, or null (not allowed here, not set, or not valid). */
export function stubUser(env: NodeJS.ProcessEnv = process.env): StubUser | null {
  if (!stubAllowed(env)) return null;
  const r = parseStubUser(env.ZOHO_STUB_USER);
  return r.ok ? r.user : null;
}

const initials = (n: string): string =>
  n.split(/\s+/).filter(Boolean).map((w) => w[0]!.toUpperCase()).slice(0, 2).join("") || "?";

/** The dataset with the signed-in stub person on it (both sides where their seat works). A copy. */
export function withStubUser(ds: Dataset, u: StubUser): Dataset {
  const person: Person = {
    n: u.n, i: initials(u.n), seat: u.leadSeat, mgr: null, on: true, c: 1, em: u.em, ph: "",
    ...(u.ext ? { ext: "the Investors pages" } : {}),
  };
  const out: Dataset = { ...ds, PEOPLE: { ...ds.PEOPLE, [u.key]: person }, SIGNINS: [...ds.SIGNINS.filter((k) => k !== u.key), u.key] };
  if (u.imRole) {
    out.im = {
      ...ds.im,
      P: { ...ds.im.P, [u.key]: { n: u.n, i: person.i, r: u.imRole, c: 1, em: u.em } },
      SIGNINS: [...ds.im.SIGNINS.filter((k) => k !== u.key), u.key],
    };
  }
  return out;
}
