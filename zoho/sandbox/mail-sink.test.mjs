// D131 invariant: the sandbox seed can never mail or SMS a real person. Run: node --test zoho/sandbox/*.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const raw = readFileSync(new URL("./manifest.json", import.meta.url), "utf8");
const manifest = JSON.parse(raw);
const EMAIL = /[A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
const all = [...Object.entries(manifest.records), ...Object.entries(manifest.deferred ?? {}).map(([m, d]) => [m, d.records])];

test("every address anywhere in the manifest is on agresearchlabs.com (zero real addresses)", () => {
  const found = raw.match(EMAIL) ?? [];
  assert.ok(found.length > 0);
  assert.deepEqual(found.filter((a) => !/@agresearchlabs\.com$/i.test(a)), []);
});

test("email fields are tech+gzseed-<seedkey-slug>@agresearchlabs.com: unique per record, valid, <= 100 chars", () => {
  const seen = new Map();
  for (const [mod, rows] of all) for (const r of rows) for (const [k, v] of Object.entries(r)) {
    if (!/email/i.test(k)) continue;
    assert.match(v, /^tech\+gzseed-[a-z0-9-]+@agresearchlabs\.com$/, `${mod}/${r.Seed_Key}.${k}`);
    assert.ok(v.length <= 100);
    assert.equal(v.split("@")[0], `tech+gzseed-${String(r.Seed_Key).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}`);
    assert.ok(!seen.has(v), `${v} is used by ${seen.get(v)} and ${mod}/${r.Seed_Key}`);
    seen.set(v, `${mod}/${r.Seed_Key}`);
  }
  assert.ok(seen.size >= 30);
});

test("every Mobile/Phone is the reserved fake range +91 90000 0xxxx, and unique", () => {
  const phones = [];
  for (const [, rows] of all) for (const r of rows) for (const [k, v] of Object.entries(r)) if (/(^|_)(mobile|phone)$/i.test(k)) phones.push(v);
  assert.ok(phones.length > 0);
  for (const p of phones) assert.match(p, /^\+91 90000 0\d{4}$/);
  assert.equal(new Set(phones).size, phones.length);
});
