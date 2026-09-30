# D110 — Owner rulings on the decisions audit (30 Sep 2026)

Answers to the seven conflicts in D108. Rulings 1–4 are the owner's words; 5–7 are housekeeping the later decisions already imply.

1. **D68 stands, on a non-administrator profile.** Sahil keeps every page and action of both sides, including logged PAN/Aadhaar/bank reveals, but his seat moves off the Administrator profile to a dedicated **Digital Infrastructure** profile with least privileges. CLAUDE.md rule 2 (no administrator token in the app) stays; the resolver is not weakened. Closes M03-S05-NOTE-3. Owner task: create the profile in Zoho and move his user (M03-S05-T02).
2. **Search scope follows the seat (replaces the search clauses of D60 and D69).** Top-bar search is not "leads only" for everyone: an IR searches leads in their own book (D69, as built); an IR Manager their team's leads; **Digital Infrastructure and the business owner search org-wide — leads and investors**; Finance/KAM/Head of AM search investors within their scope. Always on the person's own token (D53): org-wide works because those seats' Zoho roles see the org, never through a service read. The IR wall (M06-S05) stays for IR seats. Adds wiring units M06-S03-W2 (scope by seat, investors in results for org seats) and M06-S05-W2 (the wall applies per seat, tests per seat).
3. **D15 superseded fully.** Farms and allotments live in Zoho (LLP modules, D74/D75, M11). The FMS stays a separate system; farm progress reaches the investor through the LLP record via the console, not a separate investors store.
4. **Investor sign-in stays Supabase for now (D6/D79), with a feasibility spike:** can the Growize investor app connect to Zoho CRM Portals directly? If yes, the move is taken at MA1; if not, Supabase remains. Spike M20-S07-H7 (documentation-level: Portals auth, API surface, per-investor identity, cost; no sandbox needed), outcome to the owner.
5. **D10 superseded by D93** (app account opens On hold; Finance unlocks) — row marked.
6. **D24 superseded by D53** (every human on an Enterprise seat) — row marked.
7. **D20, D23, D46, D49 moot under D52** (one Enterprise org) — rows marked.
