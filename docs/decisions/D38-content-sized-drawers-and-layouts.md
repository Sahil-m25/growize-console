# D38 — Size rows and panels for their content

_16 Sep 2026 · the owner's request: fix dimensions that consume unnecessary space, starting with the investor timeline_

The Investor timeline's activity glyph was receiving a shared row's first-child text rule:
60% flex basis and a 180px minimum. Utility icons must retain their 20px footprint. The description
receives the remaining width, and timestamps move below it in narrow drawers. All history,
actors, notes and dates remain available, with the D37 access boundaries preserved.

Label styles apply to their direct label children, rather than accidentally changing nested
activity icons. System check rows and Activity columns respond to their available content width;
opening a docked drawer must not leave desktop-sized fixed columns inside a narrow main pane.
Descriptions shrink and wrap, while utility markers stay compact and metadata remains visible.

Short and empty Activity/Updates and Investor Management cards use their content height. The
Investor Management viewport-slack measurement must not inflate the final short card. Drawer
shell height and body scrolling remain useful for long content. Ordinary footer actions use
their label width, retain usable control height and wrap when needed; intentionally grouped
follow-up controls retain their own layout. Separate windows and portal overlays honor their
configured panel widths within screen bounds.

The active standalone console, its Next.js port and the Investor Management prototype are the
scope. Earlier alternate console mockups are not the active interface. Validation will cover
authored CSS and actual templates/workflows without claiming browser-rendered measurements:
the local HTML browser access was blocked by browser security policy in the previous review.

Run `node console/prototype/ux-audit/verify-redesigned.cjs`,
`node --test console/privacy-port-regression.cjs` and
`node portal/prototype/portal-privacy-check.cjs`, plus
`node portal/prototype/portal-dimensions-check.cjs`; port changes also receive TypeScript checking
and a production build. Focused dimension checks should exercise the actual icon/text selectors
and compact-layout contracts. No backend or access policy changes are part of this sizing work.

Final validation passed: 26 console source/application suites, including 43 dimension contracts
and eight deliberately rejected in-memory layout regressions; 33 port privacy/sizing cases,
TypeScript checking and a production build with 18 pages; 25 portal dimension/navigation checks
and 1,274 portal privacy/workflow checks. The port's compact Latest table escapes the generic
phone table minimum while its wider activity matrix retains horizontal scrolling. Portal page,
account, section and identity changes reset the persistent content scroller; editing retains its
position. Live rendered appearance remains unverified because local browser access was blocked.
