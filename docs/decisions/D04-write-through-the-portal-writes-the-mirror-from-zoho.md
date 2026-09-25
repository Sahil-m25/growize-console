# D4 — Write-through: the portal writes the mirror from Zoho’s answer in the same request

_4 Sep 2026_

**Why:** read-your-own-writes; the Zoho→Supabase webhook path has been dead since 13 Aug and logged 5,890 staleness alerts; portal-originated facts must never depend on it. Webhooks remain for edits made in Zoho’s UI; the nightly reconcile catches the rest.
