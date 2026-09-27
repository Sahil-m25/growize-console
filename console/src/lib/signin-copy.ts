/* The sign-in door's people — who can turn access back on, and whom to ask for help — read from
   the record, never written into the copy (rule 4: no hard-coded user). The prototype names them
   (ir-merged.js 11098, vSignin's foot); an empty book names the team instead. */

import type { Person, PersonKey } from "@/domain";

type People = Record<PersonKey, Person>;

/** the people on the record, still with the org and with a login here, who hold `seat` */
const holders = (PEOPLE: People, seat: Person["seat"]): Person[] =>
  Object.values(PEOPLE).filter((p) => p && p.on && !p.ext && p.seat === seat);

/** SIGNOUTMSG.revoked's second line: Corporate Operations and Digital Infrastructure can grant. */
export function revokedLine(PEOPLE: People): string {
  const names = [...holders(PEOPLE, "corp"), ...holders(PEOPLE, "ops")].map((p) => p.n);
  return names.length ? names.join(" or ") + " can turn it back on." : "Digital Infrastructure can turn it back on.";
}

/** The foot's "Trouble signing in? Ask …" — Digital Infrastructure's own person when there is one. */
export function signInHelp(PEOPLE: People): string {
  const di = holders(PEOPLE, "ops")[0];
  return di ? di.n + ", Digital Infrastructure & Data" : "Digital Infrastructure & Data";
}
