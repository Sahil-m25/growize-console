/* WHO THE SIGN-IN SCREEN OFFERS (D60, merged prototype vSignin): exactly the people who hold
   console access right now — a lead seat the lead rules admit (`consoleAccount`), or an
   Investors-side seat (`imHas`) held by somebody still on the record. */

import { BYGRANT, PAGECAPS } from "@/domain";
import type { CapGrid, NavKey, Person, PersonKey } from "@/domain";
import { imHas, type ImData } from "@/lib/im";
import { consoleAccount } from "@/lib/selectors/access";

/** merge-glue.js imAccount(k) */
export const imAccount = (PEOPLE: Record<PersonKey, Person>, im: ImData, k: PersonKey): boolean =>
  !!PEOPLE[k]?.on && imHas(im, k);

/** Console access by default (ir-merged.js:179). */
const DEFSEATS = ["ir", "conv", "ops"];

/* hasGrant(k) — ir-merged.js:551: somebody has granted this person at least one real screen. */
const hasGrant = (GRANT: Record<PersonKey, CapGrid>, k: PersonKey): boolean =>
  Object.entries(GRANT[k] || {}).some(([p, caps]) =>
    p !== "me" && !!PAGECAPS[p as NavKey] && !PAGECAPS[p as NavKey].nopage && (caps || []).includes("view"));

/** The lead side's door (D60, ir-merged.js:629): the three console seats always; a granted-only seat
 *  (exec, bu, corp, cp) while Digital Infrastructure has granted it a screen; Finance, Marketing and
 *  Account Management never — on top of the port's own `consoleAccount` (on, not external). */
export const leadAccount = (PEOPLE: Record<PersonKey, Person>, GRANT: Record<PersonKey, CapGrid>, k: PersonKey): boolean => {
  const seat = PEOPLE[k]?.seat;
  return consoleAccount(PEOPLE, k) && !!seat
    && (DEFSEATS.includes(seat) || ((BYGRANT as readonly string[]).includes(seat) && hasGrant(GRANT, k)));
};

type Book = { PEOPLE: Record<PersonKey, Person>; GRANT: Record<PersonKey, CapGrid>; im: ImData };

/** The merged prototype's consoleAccount(k): either side admits them. */
export const signInAdmits = (ds: Book, k: PersonKey): boolean =>
  imAccount(ds.PEOPLE, ds.im, k) || leadAccount(ds.PEOPLE, ds.GRANT, k);

/** `SIGNINS.filter(consoleAccount)` — the people listed, in the record's order. */
export const admitted = (ds: Book & { SIGNINS: PersonKey[] }): PersonKey[] =>
  ds.SIGNINS.filter((k) => signInAdmits(ds, k));
