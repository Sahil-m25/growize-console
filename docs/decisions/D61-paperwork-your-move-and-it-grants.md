# D61 — Paperwork shows as "your move" on Today and Documents; Digital Infrastructure may grant IRs extra pages

**Date:** 24 Sep 2026 · **Amends:** D60 · **File:** `console/prototype/ir-console-redesigned.html` (D60 kept as `ir-console-redesigned.D60.html`)

## Owner decisions (answers to D60's two open questions)
1. **Yes:** Digital Infrastructure may grant an IR pages beyond the IR seat's default (e.g. Numbers). This was already how D60 was built, so no code change was needed.
2. **Yes:** Today and Documents also show the IR's paperwork step as "your move".

## What changed
- `prMine` now marks an IR paperwork step as the IR's move wherever paperwork appears, for anyone who can work the lead.
  - The write itself is still accepted only from the lead page's paperwork row. The `paperSave` guard is unchanged.
  - A direct call from anywhere else was tested and is refused.
- New `irPaperStep(l)` returns the IR's one step, or nothing:
  - Tell them it's sent
  - Chase the signature
  - Send the draft
  - Get the final draft agreed
- New `goPaper(id)` opens the lead with the paperwork row scrolled into view and briefly highlighted. The step is then one tap there.
- **Today:**
  - When paperwork is a lead's top item, the row's button is the step itself ("Tell them it's sent"). It was "Review paperwork", which opened the read-only history.
  - When paperwork is not the top item, because a dated step or first-touch deadline outranks it, the row carries a small chip, e.g. "NDA · your move: Tell them it's sent". Before this, a pending NDA step was invisible on Today behind anything more urgent.
  - Paperwork that is with Finance shows "With Finance" (read-only history).
- **Documents:**
  - Waiting rows on a lead where the IR owes a step get "Your move · <step>".
  - The row opens the lead's paperwork row instead of the read-only drawer.
  - The Waiting header counts "N your move".

## Verified
- Sanjay Menon (L2, NDA sent) shows on Rohit's Today with the chip. The chip opens L2 with the paperwork row in view, and WhatsApp saves "told".
- Kavya's Documents: L7's waiting row shows the step, the header says "1 your move", and tapping opens L7.
- Full sweep: 224 page renders and 1,252 presses, 0 errors, no sideways scroll.
- D60 paperwork tests: 40/40.

Not re-scored by Jev: it is a small follow-on to a decision the owner confirmed. The lead-page paperwork row it points to was scored in D60 (load 0.05–0.27).
