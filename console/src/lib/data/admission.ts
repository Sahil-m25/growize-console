/* WHO THE SIGN-IN SCREEN OFFERS (D60, merged prototype vSignin): exactly the people who hold
   console access right now — a lead seat the lead rules admit (`consoleAccount`), or an
   Investors-side seat (`imHas`) held by somebody still on the record. */

import type { CapGrid, Person, PersonKey } from "@/domain";
import { imHas, type ImData } from "@/lib/im";
import { consoleAccount } from "@/lib/selectors/access";

/** merge-glue.js imAccount(k) */
export const imAccount = (PEOPLE: Record<PersonKey, Person>, im: ImData, k: PersonKey): boolean =>
  !!PEOPLE[k]?.on && imHas(im, k);

/** The lead side's door (D60, ir-merged.js:629): the three console seats always; a granted-only seat
 *  (exec, bu, corp, cp) while Digital Infrastructure has granted it a screen inside its ceiling;
 *  Finance, Marketing and Account Management never. One rule, asked of `consoleAccount`. */
export const leadAccount = (PEOPLE: Record<PersonKey, Person>, GRANT: Record<PersonKey, CapGrid>, k: PersonKey): boolean =>
  consoleAccount(PEOPLE, k, GRANT);

type Book = { PEOPLE: Record<PersonKey, Person>; GRANT: Record<PersonKey, CapGrid>; im: ImData };

/** The merged prototype's consoleAccount(k): either side admits them. */
export const signInAdmits = (ds: Book, k: PersonKey): boolean =>
  imAccount(ds.PEOPLE, ds.im, k) || leadAccount(ds.PEOPLE, ds.GRANT, k);

/** `SIGNINS.filter(consoleAccount)` — the people listed, in the record's order. */
export const admitted = (ds: Book & { SIGNINS: PersonKey[] }): PersonKey[] =>
  ds.SIGNINS.filter((k) => signInAdmits(ds, k));
