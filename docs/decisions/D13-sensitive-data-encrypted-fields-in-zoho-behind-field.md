# D13 — Sensitive data: encrypted fields in Zoho behind field-level security; masked only in the mirror; Aadhaar never stored; reveals logged; bank beneficiary via the bank where possible

_4 Sep 2026_

**Why:** the leak the portal was built to close; Zoho logs writes not views, so the reveal log is the only view log; no write-then-prune, because dumps and WAL keep what was written.
