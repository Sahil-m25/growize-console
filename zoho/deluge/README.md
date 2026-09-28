# Deluge guards — business rules that live in Zoho (D5)

Two validation-rule functions keep the farm shelf honest whichever door writes (the console, the Zoho UI, an import,
the API, another integration). The console also pre-checks the same arithmetic so the person sees the reason before
anything is sent; these are the lock, the console is the courtesy.

| File | Module | Rule on | Story | Console name of the refusal |
|---|---|---|---|---|
| `oversell_guard.dg` | `LLP_UnitAllocation_Module` | `Reserved_Units`, `Issued_Units`, `LLP` (three rules, one function) | M11-S07 | `oversell` |
| `take_back_guard.dg` | `LLP_Creation_Module` | `Units_Released` | M11-S04 | `units-held` |

The count is the shelf's: Reserved allotments count `Reserved_Units`, Issued count `Issued_Units`, Cancelled nothing;
free = `Units_Released` − held. The typed `Units_Reserved` / `Units_Issued` (LLP) and `Units_Available` (allotment) are
plain integers and are never read as the count.

## Install (Sahil — sandbox first, then production; M11-S07-T02)

1. **Connection.** Setup > Developer Hub > Connections > Create: service *Zoho OAuth* (Zoho CRM), name **`growize_crm`**,
   scopes `ZohoCRM.coql.READ`, `ZohoCRM.modules.READ`. Connect it as an org-level user that sees every allotment
   (the guard must count the whole org, not one person's book). On the sandbox the API host is the same `zohoapis.in`
   URL with the sandbox connection; if your sandbox uses `sandbox.zohoapis.in`, change the `url` line.
2. **Functions.** Setup > Developer Hub > Functions > New Function, category **Validation Rule**:
   - `oversell_guard`, module *LLP Unit Allocation* — paste `oversell_guard.dg`.
   - `take_back_guard`, module *LLP Creation* — paste `take_back_guard.dg`.
   Save; Deluge compiles on save — report any compile error back (the files were written without a Zoho compiler).
3. **Rules.** Setup > Customization > Modules and Fields > *LLP Unit Allocation* > Validation Rules > New:
   field `Reserved_Units` → *Validate using Function* → `oversell_guard`. Repeat for `Issued_Units` and `LLP`.
   Then *LLP Creation* > Validation Rules > New: field `Units_Released` → `take_back_guard`.
   Validation rules must apply to API writes as well as the UI (they do by default in v2.1+; confirm on the rule).
4. **Prove on the sandbox** (HUMAN PROOF):
   - Oversell: with Block B full, create an allotment on it, Reserved, `Reserved_Units` 2 (TC-IM06-017) — refused with
     "Block B has no free units for 2 units."; the allotment count on Block B is unchanged.
   - Take back: set Block A's `Units_Released` to 0 while 29 units are held (TC-IM06-005) — refused with
     "Block A has 29 units held by investors and cannot be taken back."
   - Record the API's refusal body for each (status, `code`, `details.api_name`) as fixtures under
     `console/src/lib/zoho/__fixtures__/farms/` (`guard.oversell-refused.response.json`,
     `guard.units-held-refused.response.json`). The console maps any record-level refusal blaming the rule's field to the
     named guard (`console/src/lib/zoho/client.ts` `ZOHO_GUARD_RULES` / `guardRefusalOf`); if Zoho's real code or field
     differs from the replayed fixtures, tighten `ZOHO_GUARD_RULES` there.
5. **Export** the two functions and rules into `zoho/investor/` with the rest of the org (zoho/README.md).

## What the console does with a refusal

- `server/farms/oversell.ts` — `check()` pre-checks an allotment's units; `explain()` names a Zoho refusal of an allotment
  write; `insertAllotment()` does both around one insert, for the hold / advance / add-paid writers to adopt.
- `server/farms/release.ts` — release and take-back (`POST` / `DELETE /api/farms/{id}/release`, Head of Finance); a
  take-back with units held is refused before the write, and Zoho's `units-held` refusal is named the same way.
