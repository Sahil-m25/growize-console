# D69 — Search stays separate; an IR sees only their own investors

**Date:** 25 Sep 2026 · **Decided by:** owner · **Amends:** D60 (organisation-wide search)

## Decision
- The top-bar search on the lead side searches **leads only**, within the searcher's own book (their leads, plus their team for the IR Manager and all for Sahil).
- Investor search lives **on the Investors page** and is available only to Investors-side seats.
- An IR never searches or sees investor data unless the investor came from **that IR's own lead**.

## Consequences
- M06-S03 is rewritten as a lead-only search. The read-only peek (old E06-S04) is dropped.
- New stories: M06-S05, M09-S08, and M03-S09 (enforced at the data layer and the scope-keyed cache).
- Contacts get `Origin_Lead` and `Originating_IR` fields (Zoho write, needs approval).

## Still open (OD2)
- Mechanism. Recommended: a Zoho record share to the originating IR at hand-off, so that Zoho enforces it. The alternative is a server filter only.
- What "own" means. Recommended: the IR who owned the lead at "Said yes".
- Which sections an IR sees.
- Whether an IR gets the Investors page at all.
