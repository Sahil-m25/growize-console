# D48 — The Investor Management portal comes onto the console's design architecture, except where Finance's job is genuinely different — and that exception is step-up

_22 Sep 2026 · the owner's instruction, that the design architecture built for the IR console be used for the portal too · rests on D27, D28, D29, D33, D35, D38, D40, D41 · names what must not be shared · full analysis in `docs/im-portal-design-alignment.md`_

## What was actually found

The two prototypes share an ancestor, not a design system. Of the portal's 170 CSS selectors, 112
carry names the console also uses, but **only 34 have an identical declaration block** — and all 34
are frame: `.app`, `.main`, `.pane`, `.secw`, `.cols`, `.scrim`, `.secbar`, `*`, `button`, `th`.
Every visual rule sits among the 78 that differ. The same 34 come out identical against all four
pre-redesign console files, so the portal is not drifting toward any version of the console; it
forked and stopped.

Concretely, the portal today: loads **Archivo from Google Fonts**, which is the exact failure D27
embedded Inter as 178 KB of base64 to avoid; carries **no `<svg>` and no `ICONS` map** at all, with
the theme button as the character `◐`; has no `--ctl`/`--rc`/`--text-*` tokens, so its `.act` is
34px on an 8px radius against the console's 36px on 6px; is missing `.sel` and `.tgl`; still uses the
pre-D28 20px `.chip`; and has **no doctype, no `<html>` and no `<main>`** — quirks mode, which is
where the console was before D32. Of the behavioural mechanisms: the drawer contract is present and
close. `panel()`/`doorRow()` is absent, solved instead with `secBar` tabs on four screens. Pop-out is
absent. The refusal pattern is absent — **18 native `alert(` and 3 `confirm(`** survive, where D33
converted 37. `commit()` is absent: writers mutate, `log()`, `draw()`, across 30 log sites, with no
double-press guard and no "Not saved yet". D41's freshness is absent entirely.

## This is a rewrite, and the bigger half is not the stylesheet

Tokens, control family, font, icons and doctype are roughly 350 lines of chrome. The behavioural
half — `commit()` and the save queue rebuilt around money, the refusal pattern, freshness, the
one-screen mechanism — is roughly 700 lines ported plus a pass over 40 of the portal's 66 top-level
functions. The 1,528 lines of domain rendering survive intact. Verified as a rewrite rather than a
restyle (Jev 0.88).

## What is shared, and how

A **generated fence**, not a shared stylesheet. A `<link>` to a common file breaks `file://` and the
artifact viewer, which is the precise failure D27 embedded the font to avoid, and both prototypes are
single self-contained files by design. The repo already has the mechanism in
`embed-save-queue-runtime.cjs`; extend it to CSS and fence exactly three things — the two
`@font-face` rules, the three `:root` forms (69 declarations), and the 259 control-family rules.
Everything else stays duplicated under a stated sync rule, on the precedent of `console.css`'s marked
PORT-ONLY appendix.

That precedent comes with a warning, found while checking it: **the appendix is no longer verbatim** —
2,379 lines against the prototype's 2,343, with 38 lines added and documented. A rule that is not
checked does not hold, so the fence needs a check in CI, not a comment.

## What must not be shared

- **Step-up authentication.** This is the exception that matters. The console's `askFirst()` asks
  whether you meant to do something; D22's step-up asks whether you are who you say you are. They are
  different questions and need different mechanisms — a fresh code, a failure count, a lock at three
  (Jev 0.87 that conflating them would weaken the control). The portal's `reveal()` currently asks a
  reason and logs it, with no code, no count and no lock, and no reversal, erasure or export path
  exists at all. **Step-up is built for the portal, not borrowed from the console.**
- The slate-blue accent. `--ir` green against `.prov.link` violet is the one-fact-one-writer marking,
  and both files already implement it. It carries meaning, not taste.
- `--hold`, and the mono tabular numerals in the ledger. Money reads differently from a lead.
- The rail's four group labels.
- `vOne` stays sectioned rather than panelised — D35's page-cutting test was run on the console's
  jobs, not Finance's.

## What this does not settle

The rendered appearance was not verified: browser access was blocked here as it was for D38, so the
one-screen judgements are inferred from line and card counts rather than measured. The fork point
cannot be pinned to a commit — there is one commit and 167 uncommitted files. And D27's own count is
wrong somewhere: it specifies 33 glyphs, the prototypes carry 29 and 24, and 14 `d-*` door keys are
absent from `ICONS`, so `ic("d-history")` returns empty today. That is a live defect in the console,
logged as C-04 in `CARRY-FORWARD.md`, and it should be fixed before it is propagated.

## Sequencing

Nothing here starts before the portal's own mapping is acted on — `allot()` will be refused by the
blueprint, and B36's statement upload does not exist, and both are more urgent than a font. Stage 3
does not begin until week 7. The chrome half can be done at any time and carries no behavioural risk;
the behavioural half waits on B-01, B-04 and B-05 in the carry-forward, because `commit()` around
money depends on where pending writes live.
