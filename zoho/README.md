# Zoho — the org is code too

Every customisation is exported and committed here. Never a console-only change.

```
leads/      the Leads org: modules, fields, layouts, blueprints, validation rules, workflows, profiles, roles
investor/   the Investor org: the same, plus approval processes and custom functions (Enterprise-only)
```

Export before every commit that touches Zoho, and put the export in the same commit as the code that
depends on it. The reason is D5: business rules are enforced *in Zoho*, so a rule that exists only in
someone's browser is a rule that vanishes when that person leaves.

`fields.json` in each folder is the authoritative map of `Field_API_Name` → what it means. It is
produced in week 1 and is what every mapper, every contract and every test refers to.
