# D33 — Every page is one screen; what left it opens from a door

_11 Sep 2026 · answers "the scrolls are still infinite" · supersedes the half of D28 that removed the frame without cutting the content_

D28 removed the fixed one-screen frame because its private scrollbars were the thing people hated.
That was right and incomplete: the content was never cut, so the console traded inner scrollbars for
one endless page. Measured at 1440 × 900 before this change, **Activity was 6.9 screens, Profile 3.2,
Plan 3.4, My day 3.8** — almost every page was two to seven screens, and the complaint was fair.

## The mechanism

A **panel** is a section that used to sit in a page body and now opens from a labelled tile.

```js
panel("today.week", {t:"The week ahead", w:560, sub:()=>…, body:()=>`…the same markup…`});
doorRow([{k:"today.week", t:"The week ahead", v:"3 dated"}]);
```

A panel **is** a drawer, so it inherits the whole contract already built: focus handling, Escape, the
phone bottom sheet, and the pop-out window. Keys resolve through one function — `drawerDef(k)` reads
`PANELS` for a `p:` key and `DRAWERS` for anything else — so a panel is registered beside the page it
came from without caring what has been evaluated yet.

**Nothing was deleted.** Sixteen panels now hold what used to be scrolled past.

## What each page keeps

Its heading, the numbers read at a glance, and **the one queue or table the person acts on**. That
queue is allowed to be the tallest thing on the screen; everything else is a tile.

| Page | Was | Now | What moved |
|---|---|---|---|
| Activity | 6,225px | 900px | the month heatmap, the per-person tally, the touch counts |
| Profile | 1,936px | 900px | the roster, the page-by-page reach grid |
| Plan | 2,141px | 1,327px | funnel rates, demand mix, service levels, inventory, who writes what |
| My day | 2,534px | 1,672px | the week ahead, the closers list, the quota arithmetic |
| Updates | 1,768px | 1,185px | the chronological feed |
| Investor transfers | 1,861px | 1,433px | the three-paragraph explanation of what reconciles |
| Leads | 1,574px | 1,439px | forecast, source and owner cuts of the rail |

An IR's every page is now one screen. The manager's My day, Leads, Transfers and Numbers sit between
1.4 and 1.7 screens, each dominated by a real table — scrolling a queue is expected; scrolling past
chrome to reach one is not.

## Two defects found while cutting

- **`vGoals` never closed its `.ph`**, so the page header element wrapped the entire Plan page. Closed.
- **The closers list on My day duplicated the queue below it** — the same lead's record button appeared
  twice on one screen, which the design review had already flagged as a P0. Moving the list behind a
  door removes the duplicate as well as the height.

## Also in this build

- **Sign out is visible.** It was inside a drawer behind an avatar that did not look like a control.
  It is now a labelled button in the top bar, and the account block carries a chevron.
- **A blocked pop-out says so.** `window.open` refused by the browser used to open the side drawer
  silently, so asking for a window and getting a panel looked like the console ignoring you. The
  drawer now carries a line saying the browser blocked the window, with a control to try again.

Verified: 164 page-views across 8 seats × 2 themes, all 16 panels, all 29 drawers, every lead door and
three phone widths — zero script errors.
