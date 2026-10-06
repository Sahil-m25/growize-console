/* COQL WHERE folding. Zoho rejects (400) a WHERE with more than two conditions unless they are nested in brackets
   pairwise — its docs show `where ((A and B) and C)`. These fold a list of conditions that way, so a clause never
   depends on how many parts happen to be present. Pure; each part is ONE condition or an already-bracketed group — a part
   that is itself a flat `x and y` must be wrapped in brackets by the caller, or it widens the clause past two. Empty list -> "" (the caller decides what no condition means). */
function fold(parts: readonly string[], op: "and" | "or"): string {
  const p = parts.filter((x) => x !== "");
  if (p.length === 0) return "";
  let acc = p[0]!;
  for (let i = 1; i < p.length; i++) acc = `(${acc} ${op} ${p[i]})`;
  return acc;
}

/** a and b and c -> ((a and b) and c); one part is itself, two are (a and b). */
export const coqlAll = (parts: readonly string[]): string => fold(parts, "and");
/** a or b or c -> ((a or b) or c); one part is itself, two are (a or b). */
export const coqlAny = (parts: readonly string[]): string => fold(parts, "or");

/** True when the whole clause is one bracketed group — its first "(" closes at the very end (quoted text is skipped). */
function isOneGroup(s: string): boolean {
  if (s[0] !== "(" || s[s.length - 1] !== ")") return false;
  let depth = 0, quoted = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (quoted) { if (c === "\\") i++; else if (c === "'") quoted = false; continue; }
    if (c === "'") quoted = true;
    else if (c === "(") depth++;
    else if (c === ")" && --depth === 0) return i === s.length - 1;
  }
  return false;
}

/** The clause as one bracketed unit for `where …`: unchanged when it already is one group, else wrapped. */
export const coqlWhere = (clause: string): string => (isOneGroup(clause) ? clause : `(${clause})`);
