# D40 — Lead operators, business viewers and explicit sensitive access

_16 Sep 2026 · owner clarification during console review; supersedes conflicting console role defaults in D24, D30 and D39_

[D42](D42-ir-read-only-finance-history-mirror.md) subsequently grants IRs read-only Finance history for their current held leads. It supersedes the IR payment/document default denial below and console document-round writing; other-role explicit access remains in force.

[D44](D44-active-secondary-access-and-manager-finance-views.md) subsequently grants the IR manager read-only Payments/Documents for their assigned team and removes dormant secondary lead/Finance reads. It supersedes the default manager denial below; other viewer defaults and source-writer restrictions remain.

IR and the IR manager operate leads. The optional Channel Partner seat operates only its primary-assigned leads. Business viewers can read the lead scope they are entitled to, without My day, capture, personal lead scope, contact, ownership or other lead-write controls. A role change also closes stale drawers, drafts and direct write attempts. Keep each viewer's separate Plan, team, roster and system authority; lead read-only does not mean the entire console is read-only.

Marketing is not a console seat. Finance remains an external Investor Management/source actor, with no console login. Historical actor references remain in records. Digital Infrastructure retains its broad administration and read authority. The IR reporting chain sits under the BU owner; actual production identities and managerial links must come from authenticated staff configuration, not demo persona names.

Payments and Documents are explicit permissions. Remove default views for IR, IR manager, Ops lead, founder and BU owner; Digital Infrastructure retains its own broad access. Temporary view grants require an authorized holder with the relevant unborrowed access, a reason, an expiry and a compatible managerial ceiling. Borrowed rights cannot be lent onward. Grants cannot turn a business viewer into a lead operator, give a Channel Partner team scope, or authorize console ledger/document-source writes. Page routes, record drawers, account files, metrics, activity, history, notifications, exports and references use the same current permission. Generic lead stages, signature gates and reservation dates remain workflow facts.

Profile is reached through the top-right name/account menu. It is absent from the sidebar while its authenticated route and own-account permission remain available.

Channel Partner captures force primary owner and source partner to the current partner. Secondary, cover, reporting links, unassigned pools and source attribution cannot expand partner visibility. Internal capture can tag a named partner. Store a stable nullable `channelPartnerId` separately from current ownership; preserve it when an IR receives the lead. Unknown legacy attribution stays unknown. This field is metadata, never an access grant.

The standalone prototype and Next.js port implement these frontend boundaries on sample data. Authenticated backend queries and write endpoints must enforce the same record, capability, expiry and role rules before real data is connected. No production staff account or source schema was provisioned by this change.
