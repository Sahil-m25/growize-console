# D5 — Business rules are enforced in Zoho (blueprints, validation rules, custom functions, field-level security)

_4 Sep 2026_

**Why:** with seats, Zoho’s own UI is a second door; a rule that lives only in the portal is a suggestion.

**Amended 22 Sep 2026 (D50).** Five rules are now enforced outside Zoho. Two are **forced** by the platform and would be true on any edition: the Lost guard, because the money fact lives in another org and no Zoho rule reads across orgs; and the identity reveal, because Zoho logs writes and never views, so a read cannot be gated or audited there at all. Three were **chosen**, all three because the Leads org is Professional: D44's cover windows, viewer scoping, and the manager's approval. A rule enforced in the application layer is only as durable as that layer, is invisible to anyone who reaches Zoho directly, and is not covered by Zoho's own audit — which is the failure this decision was written to prevent. Every such rule must name itself here, and the count is the measure of how far the system has moved from this decision. Full record: `D50-the-last-three-blockers-and-the-drift-in-d5.md`.

**23 Sep 2026 (D51):** Count revised: five rules outside Zoho become **three** under Enterprise (the two forced ones, and viewer scoping pending B-11), and **two** if T11 holds and the Lost guard can become a same-org validation rule. The identity reveal can never move: Zoho does not see reads. Full record: `D51-one-enterprise-org-built-from-the-super-admin.md`.

**23 Sep 2026 (D52):** Count revised to **two** rules outside Zoho — the identity reveal, which can never move, and viewer scoping pending B-11. The Lost guard returns to Zoho as a condition on the Lead's gate column. With Lite users for viewers, **one**. Full record: `D52-one-enterprise-org-for-leads-and-investors.md`.

**23 Sep 2026 (D53):** Count revised to **one** rule outside Zoho — the identity reveal. Viewer scoping moved into Zoho when viewers took full seats. Full record: `D53-every-human-on-an-enterprise-seat-and-the-cache-keyed-by-scope.md`.
