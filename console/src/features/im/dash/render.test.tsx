import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { imDemoData } from "@fixtures/im/demo";
import { initialImUi, myBook } from "@/lib/im";
import { AmCards, ImDash } from "./index";

/* the rendered page's text, tags dropped and React's entity escapes undone */
const text = (h: string) => h.replace(/<br\/?>/g, " ").replace(/<[^>]+>/g, "")
  .replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const page = (me: string) => {
  const s = { data: imDemoData(), ui: initialImUi() };
  const html = renderToStaticMarkup(<ImDash s={s} me={me} dispatch={() => {}} />);
  return { html, t: text(html) };
};

describe("ImDash — vDash", () => {
  it("Head of Finance (harsha): the signals, the queue and its controls", () => {
    const { html, t } = page("harsha");
    expect(t).toContain("Harsha's day3 waiting on you · 1 today");
    expect(t).toContain("₹8.88 Cr banked · ₹1.13 Cr outstanding · Payments→");
    expect(t).toContain("2 holds ending within 30 days · ₹2,50,000 at risk · Investors→");
    expect(t).toContain("56 units free to sell · Farms→");
    expect(t).toContain("6 tickets open · Tickets→");
    expect(t).toContain("An IR says the money has arrived — confirm it · from Rohit · ARL-INV-0208Answer it");
    expect(t).toContain("Balance due — hold ends in 21 days · ARL-INV-0208Open the record");
    expect(html).toContain('aria-label="Elsewhere today — each opens its page"');
    expect(t).not.toContain("Super user.");
  });
  it("Key Account Manager (imran): the day is about conversations owed", () => {
    const { t } = page("imran");
    expect(t).toContain("Imran's day4 accounts · 2 waiting on you");
    expect(t).toContain("Waiting on you2 today");
    expect(t).toContain("Gone quiet — 6 days past the Tier A cadence · ARL-INV-0205Log a conversation");
    expect(t).not.toContain("banked");
  });
  it("Head of Account Management (divya): the whole book, assign and introduce", () => {
    const { t } = page("divya");
    expect(t).toContain("Divya's daythe whole book · 5 waiting on you");
    expect(t).toContain("Handed over and never introduced · ARL-INV-0217Record the introduction");
    expect(t).toContain("Tier B and nobody is looking after them · ARL-INV-0211Assign manager");
  });
  it("Auditor (latha): a read-only seat with nothing to do", () => {
    const { t } = page("latha");
    expect(t).toContain("Latha's daynothing waiting on you");
    expect(t).toContain("Nothing is waiting on this seat. This is a read-only seat — the queue belongs to the people who can act on it.");
  });
  it("Super user (sahil): both queues, and the note that says whose they are", () => {
    const { t } = page("sahil");
    expect(t).toContain("Sahil's day5 in Finance's queue · 5 in Account Management's · 3 today");
    expect(t).toContain("Super user. These are other people's queues. Finance (primary doer: Harsha Bhat) owns money and paper;");
    expect(t).toContain("Finance's queue · primary: Harsha Bhat");
    expect(t).toContain("Account Management's queue · primary: Divya Kamath");
  });
  it("Administrator (pradeep) has no dashboard", () => {
    expect(page("pradeep").html).toBe("");
  });
  it("amCards: the cadence card, mine and the whole book", () => {
    const s = { data: imDemoData(), ui: initialImUi() };
    const mine = text(renderToStaticMarkup(<AmCards s={s} me="imran" book={myBook(s, "imran")} mine />));
    expect(mine).toContain("The cadenceyour book, by tier");
    expect(mine).toContain("That is");
    expect(mine).toContain("a month of yours.");
    const all = text(renderToStaticMarkup(<AmCards s={s} me="divya" book={myBook(s, "divya")} mine={false} />));
    expect(all).toContain("the whole book, by tier");
    expect(all).toContain("of them sit in the pool, which means they belong to whoever is free — the arrangement that works until it does not.");
  });
});
