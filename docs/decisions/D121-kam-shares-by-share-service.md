# D121 — KAM record shares are made by a background share service (owner, 5 Oct 2026)

> **Superseded by D122 (5 Oct 2026).** The share service, its nightly reconcile, the pending/failed queue, the share-status UI and Retry route, and the "Share Service" role/profile are retired. The console now writes only Contacts.KAM, as the acting person; Zoho's own user-lookup sharing (Contacts.KAM, KAM_Access on allotments and Touches), its workflows and a scheduled Deluge consistency check give the KAM access. The "Simple KAM management (UI)" section below is still valid. See [D122](D122-zoho-native-kam-access-draft.md).

**Ruling:** option 2. A background "share service" user (D53 service credential, never a screen) shares an investor with its KAM. IR Manager and Digital Infrastructure also hold Share, for cover windows and fixes. The owner also asked for a simple way to assign, add, remove and edit KAMs.

## What the share service does (console/src/server/investors/kam-share*.ts)
- When the KAM is set or changed, it shares with the new KAM, read/write:
  - the Contact;
  - its allotments;
  - the Touches of its origin lead.
- Receipts are never shared (money stays with Finance).
- It revokes the old KAM's shares. It never revokes the record owner's or the Originating_IR's.
- It refuses when the Contact doesn't name that KAM ("stale").
- When it runs:
  - straight after PUT /api/investors/[id]/kam and after each Contact a book move moves, within the request deadline;
  - what doesn't finish stays "pending";
  - a KAM taken off the seat has their shares revoked.
- Nightly job /api/jobs/kam-share-reconcile:
  - retries pending and failed shares;
  - compares every Contact that has a KAM with its actual shares, adds what's missing and revokes stray KAM shares;
  - keeps manual shares, and resumes from a stored cursor.
- The investor drawer shows "Shared with KAM ✓ / Sharing… / Share failed — Retry" (GET/POST /api/investors/[id]/kam/share[/retry]).

## Simple KAM management (UI)
- **Assign / change / remove:** investor → "Who looks after them" → Name a manager / Change / Remove. Remove asks for confirmation and returns the account to the pool.
- **Move a whole book:** Teams → the KAM's row → Move book (POST /api/kams/[userId]/move-book, resumable).
- **Add a KAM person:** Teams → Seat for <name> → Key Account Manager.
- **Remove a KAM person:** change their seat, then choose "move their accounts, then change the seat" or "return them to the pool".
- **Edit what the KAM seat may do:** the rights grid (D115/D116).

## Fixes found on the way (FACT CHANGE)
- Zoho v8 share bodies are `shared_with:{id,type:"users"}` with `read_only|read_write|full_access`.
- `DELETE /{module}/{id}/actions/share` revokes **every** share on the record. A per-user revoke is a GET followed by a PUT of the remaining list.
- `client.share()` now sends the v8 body. `client.unshare()` now revokes one user only.
- Before this fix, closing an IR cover window would have wiped the originating IR's and the KAM's shares.

## Zoho configuration (zoho/access/spec.json; not yet applied)
- New profile "Share Service": View on Contacts, allotments, Touches and Leads; Share on Contacts, allotments and Touches; identity, bank and money hidden.
- It reaches every record through read sharing rules to a new "Share Service" role.
- Share is also turned on for IR Manager and Digital Infrastructure.
- **Human:**
  - create the "Share Service" role;
  - in live, one Enterprise seat for the share-service user;
  - in the sandbox (5-developer cap reached), trial it on a reassigned test user.

## Open
- P13: whether a read-only sharer can grant read/write; if not, the reach rules become read/write.
- P14: IR Manager gets View on allotments, because Zoho only enables Share under View; money stays hidden.
- Who restores a missing Originating_IR share, the hand-off job or this one (rule 5).
- The People page can't seat a person who has no Investors seat yet (a cross-side rule decision).
- Job time budget: about 10 Contacts per 25 s call, so schedule the reconcile every few minutes overnight.
