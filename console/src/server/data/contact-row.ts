/**
 * One Contact as the Investors side reads it (projection ./projections PROJECTIONS.contacts — no PAN,
 * no bank, no Aadhaar). Shared by ./adapters (list reads) and ./ir-guard (one investor by id), so both
 * parse the origin fields (Origin_Lead, Originating_IR) the IR guard decides on the same way.
 */

import type { ZohoRecord } from "../../lib/zoho/client";

const RECORD_ID = /^\d{15,22}$/;

export interface ContactRow {
  readonly id: string;
  readonly code: string;
  readonly firstName: string | null;
  readonly lastName: string;
  readonly mobile: string | null;
  readonly email: string | null;
  readonly city: string | null;
  readonly address: string;
  readonly residency: string | null;
  readonly nominee: string | null;
  readonly kamId: string | null;
  readonly kamSince: string | null;
  readonly introAt: string | null;
  readonly originLeadId: string | null;
  /** The origin lead's name as the Origin_Lead lookup carries it — what the screens print instead of the record id (W3-2). */
  readonly originLeadName?: string | null;
  readonly originatingIrId: string | null;
  readonly saidYesAt: string | null;
  readonly createdAt: string | null;
}

export const idOf = (v: unknown): string | null => {
  if (typeof v === "string" && RECORD_ID.test(v)) return v;
  const id = v && typeof v === "object" && !Array.isArray(v) ? (v as { id?: unknown }).id : undefined;
  return typeof id === "string" && RECORD_ID.test(id) ? id : null;
};
export const str = (r: ZohoRecord, k: string, max = 250): string | null => {
  const v = r[k];
  return typeof v === "string" && v !== "" ? v.slice(0, max) : null;
};
const day = (v: string | null): string | null => (v && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
export const stamp = (v: string | null): string | null => (v && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v) ? v.slice(0, 16) : day(v));

/** A lookup's display name ({ id, name }), or null. */
const lookupName = (v: unknown): string | null => {
  const n = v && typeof v === "object" ? (v as { name?: unknown }).name : undefined;
  return typeof n === "string" && n.trim() ? n.trim().slice(0, 120) : null;
};

export function parseContact(r: ZohoRecord): ContactRow | null {
  if (!idOf(r.id)) return null;
  const lastName = str(r, "Last_Name", 80);
  if (!lastName) return null;
  const addr = [str(r, "Mailing_Flat_House_No_Building_Apartment_Name"), str(r, "Mailing_Street"), str(r, "Mailing_City", 120),
    str(r, "Mailing_State", 120), str(r, "Mailing_Zip", 30), str(r, "Mailing_Country", 120)].filter(Boolean).join(", ");
  const nominee = str(r, "Nominee_Name", 120);
  const rel = str(r, "Nominee_Relation", 40);
  return Object.freeze({
    id: r.id, code: str(r, "ARL_ID", 40) ?? "", firstName: str(r, "First_Name", 40), lastName,
    mobile: str(r, "Mobile", 30), email: str(r, "Email", 100), city: str(r, "Mailing_City", 120), address: addr,
    residency: str(r, "Residency", 40), nominee: nominee ? (rel ? `${nominee} (${rel})` : nominee) : null,
    kamId: idOf(r.KAM), kamSince: stamp(str(r, "KAM_Since", 40)), introAt: stamp(str(r, "KAM_Intro_At", 40)),
    originLeadId: idOf(r.Origin_Lead), originLeadName: lookupName(r.Origin_Lead), originatingIrId: idOf(r.Originating_IR), saidYesAt: stamp(str(r, "Said_Yes_At", 40)),
    createdAt: stamp(str(r, "Created_Time", 40)),
  });
}
