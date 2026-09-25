# D28 — The console is a page that scrolls, styled on shadcn/ui's tokens; the workflow is untouched

_10 Sep 2026 · amends D26's stylesheet and the one-screen frame · the flows, labels and click handlers are as they were_

Sahil's verdict on the second pass: he likes the workflow and how it moves, and does not like the fixed frame with its private scrollbars, the buttons, or the "windows" (cards and panels). He asked for the best a lead UI/UX designer would do, with shadcn/ui and similar as the reference.

**The frame.** The desktop used to be exactly one screen: `.main` was `100vh; overflow:hidden`, every column scrolled inside itself, and a script stretched the last card to the floor (`.fill`). That is gone. The page is one document that scrolls; the sidebar and the top bar are sticky; the docked drawer is sticky; the leads rail is sticky under the top bar; the only element that owns a scrollbar is a table wider than the screen. `go()` and `setSec()` scroll the window to the top so a new page starts at its heading. The `.fill` class is still set by the script and now does nothing — kept so the port does not have to touch that code.

**The tokens** are shadcn/ui's zinc scale with Growize green as `primary`: `--bg #fafafa` (background), `--card #fff`, `--card-2 #f4f4f5` (muted), `--line #e4e4e7` (border), `--ink #09090b` (foreground), `--ink-3 #71717a` (muted-foreground); dark is `#09090b / #121215 / #1b1b1f / #27272a / #fafafa / #8b8b95`. One focus ring, `--ring`, on every control. Radius: 6px controls, 12px cards.

**The components**, mapped onto shadcn's: `.act` = Button default (36px, 14px medium, green), `.btn` and `.act.ghost` = Button outline, `.chip` = outline that tints green when selected, `.tgl` = Button sm outline, `.secbar` = Tabs, `.sel` `.selw` `.inp` `.di2` and the search = Input (36px, ring on focus, chevron on selects), `.tag` = Badge (6px, tinted, no border when coloured), `.card` = Card (20px padding, 15px semibold title, 52px header), `.drw` = Sheet (16px title, 20px padding, ghost close), the rail = Sidebar (240px, 34px items, muted active), tables = Table (40px muted header, 13.5px, row hover, no column dividers), the queue = a list inside one card with a 3px urgency edge per row — not cards inside a box.

**What did not change.** Every page, section, drawer, label, sentence, count, breakpoint and handler. The phone re-layout below 760px still works; its frame overrides are now no-ops.

**Consequence.** D26's rule stands: the `<style>` block is the design system, copied verbatim to `console/src/app/console.css`. The two-line `window.scrollTo(0,0)` belongs in the router's navigation, not in a component.
