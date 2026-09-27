import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { imDemoData } from "@fixtures/im/demo";
import { initialImUi } from "@/lib/im";
import type { ImState } from "@/lib/im";
import { SignCell } from "./SignCell";
import { InvEmails } from "./Emails";
import { UploadList, UploadPanel } from "./Upload";

const st = (f?: (s: ImState) => void): ImState => { const s = { data: imDemoData(), ui: initialImUi() }; if (f) f(s); return s; };
const d041 = (s: ImState) => s.data.DOCS.find(d => d.id === "D-041")!;

describe("paper2 pieces", () => {
  it("SignCell: Viewed with its time, and reminder and recall for a doc seat only", () => {
    const s = st();
    const h = renderToStaticMarkup(<SignCell s={s} me="meena" dispatch={() => {}} d={d041(s)} />);
    expect(h).toContain("Viewed 31 Aug 19:05");
    expect(h).toContain(">Send a reminder</button>");
    expect(h).toContain(">Recall</button>");
    const ro = renderToStaticMarkup(<SignCell s={s} me="latha" dispatch={() => {}} d={d041(s)} />);
    expect(ro).toContain("Viewed 31 Aug 19:05");
    expect(ro).not.toContain("Send a reminder");
  });
  it("SignCell: shows the reminder time, and Declined with its reason", () => {
    const s = st(x => { x.data.SIGN!["D-041"].reminded = [{ at: "02 Sep 10:15", by: "meena" }]; });
    expect(renderToStaticMarkup(<SignCell s={s} me="harsha" dispatch={() => {}} d={d041(s)} />)).toContain("Reminder sent 02 Sep 10:15 by Meena");
    const dl = st(x => { x.data.SIGN!["D-041"] = { Sign_Request_Id: "x", st: "declined", why: "Wrong unit count" }; });
    expect(renderToStaticMarkup(<SignCell s={dl} me="harsha" dispatch={() => {}} d={d041(dl)} />)).toContain("Declined — Wrong unit count");
  });
  it("InvEmails: the list for a reader, an in-page refusal for anyone else", () => {
    const s = st();
    const h = renderToStaticMarkup(<InvEmails s={s} me="harsha" id="ARL-INV-0208" />);
    expect(h).toContain("<th>From</th><th>Subject</th><th>When</th>");
    expect(h).toContain("Balance for Block B");
    expect(h).not.toContain("second week of September");   /* the body only when opened */
    expect(renderToStaticMarkup(<InvEmails s={s} me="imran" id="ARL-INV-0208" />)).toContain("This record is not one you can open, so its emails were");
  });
  it("UploadPanel: refused for a read-only seat; a labelled file box and the allowlist for Finance", () => {
    const s = st();
    expect(renderToStaticMarkup(<UploadPanel s={s} me="latha" dispatch={() => {}} />)).toContain("Uploading belongs to Finance Operations, Compliance and the Head of Finance.");
    const h = renderToStaticMarkup(<UploadPanel s={s} me="harsha" dispatch={() => {}} />);
    expect(h).toContain("PDF, JPG or PNG · up to 20 MB");
    expect(h).toMatch(/<label class="fi"><span>File — choose one, or drop it here<\/span><input[^>]*type="file"/);
    expect(renderToStaticMarkup(<UploadList s={s} me="harsha" />)).toContain("neft-advance-24aug.png");
  });
});
