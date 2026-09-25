# D37 — Align the work queue and enforce user data visibility

_15 Sep 2026 · the owner's request: make the UI symmetrical and fix activity and other data bleeding_

The screenshot comes from `console/prototype/ir-console-redesigned.html`. Its queue now uses
consistent status and action columns, equal queue/context columns, equal row spacing and a 44px
minimum primary action height. When the queue itself becomes narrow, actions stack below the
investor details. The matching daily-work stylesheet remains synchronized with the embedded CSS.

Activity is a person's work. Ordinary staff read their own actions. An explicit permission to read
others permits oversight of the actual reporting chain, including historical staff still in that
chain. Sharing an investor record does not grant access to a colleague's personal Activity.
Authorized investor timelines still contain the conversations and facts needed to work that
relationship. Actor filters, calendar counts, summaries and exports cannot broaden record access.

Record scope and page permissions are both required. Opening a borrowed page does not grant access
to unrelated investors. Payments, documents, transfers, reconciliation, reference reveals, copy
actions, duplicate feedback, updates, direct record URLs, drawers and separate windows enforce
that boundary. Removing access invalidates the next render. Deactivated accounts cannot keep an
effective session. Broad reporting presets retain their intentional aggregate access; manager and
borrowed reporting views use their authorized records. Global system audit requires the operator's
own administrative permission, so a borrowed System page cannot expose the organization log.

Private drafts and read markers belong to their author. Changing identity clears pending forms,
reveals, failed writes, open windows, contact-return listeners and live announcements. Paper links
are isolated by author, investor and round; member forms and help searches are cleared at the end
of a session. Delayed CSV reads and announcements carry the session's generation, so returning to
the same identity cannot revive an earlier session's private inputs. Staff mobile changes log the
fact of the change without old or new numbers. Money log notes follow the same monetary visibility
rule as the primary screens, including exports and shared investor timelines.

Cover and temporary grants require valid windows and active identities. Expiry, revocation,
deactivation and a reduction in the lender's permissions remove borrowed access. Access windows
retain their year so an old grant cannot become live again in a later year. Handover retains the
complete impact while anonymizing investor records outside the reviewer's access.

The corresponding access defects are repaired in the Next.js lead-console port and the standalone
Investor Management prototype. The latter also masks identity values in free-text notes, scopes
document registers and uses generic event labels with withheld investor details in administrators'
audit screens; actor and time remain available. These are frontend implementations with local sample data; this
decision does not claim production authentication, persistence or server authorization. D13, D22
and D24 still require the authenticated backend and mirror to enforce the same policies. All sample
records embedded in an HTML file or client fixture bundle remain readable from its source.

Validation uses the real selectors, reducers, generated UI and export contents with synthetic
fixtures. The complete console stylesheet is parsed and declared contrast pairs are checked.
Browser security policy blocked access to the local HTML, so live rendered layout was not verified.

Run the regression checks from the repository root:

```powershell
node console/prototype/ux-audit/verify-redesigned.cjs
node --test console/privacy-port-regression.cjs
node portal/prototype/portal-privacy-check.cjs
```

From `console`, also run `npm run typecheck` and `npm run build`.

Final validation passed: 25 console source/application suites (including the final 59-case record
and session privacy check), 28 Next.js privacy cases, TypeScript checking and a production build
with 18 pages, and 1,274 Investor Management checks. Console contrast checks covered 46 declared
text/control pairs. These are source and inert application checks; rendered appearance was not tested.
