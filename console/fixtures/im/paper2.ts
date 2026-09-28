/* ── fixtures/im/paper2.ts — demo records for the stories added after the prototype ─────────
   M12-S02 (uploads), M12-S05 (Zoho Sign status) and M12-S09 (an investor's emails). None of these
   exist in the merged prototype; they are invented from each story's acceptance criteria, on the
   same fictional people and dates as the rest of the demo book (Investors side: 2 Sep 2026).
   Nothing here changes a prototype record or count: the Zoho Sign line is on the one document
   already out for signature, and the uploads and emails are new collections of their own.
   ────────────────────────────────────────────────────────────────────────────────────────── */
import type { ImSign, ImUpload, RecEmail } from "@/lib/im";

/* D-041, Joseph Mathew's FEMA declaration (sent 26 Aug by Meena, Class 3 DSC): he opened it */
const SIGN: Record<string, ImSign> = {
  "D-041": { Sign_Request_Id: "ZS-2608-41190", st: "viewed", viewedAt: "31 Aug 19:05" },
};

const UPLOADS: ImUpload[] = [
  { id: "UP-002", Scope: "Project", Doc_Type: "Farm report", Investor: null, LLP: "A",
    File_Name: "block-a-flowering-aug.pdf", File_Size: 2_411_520, File_Type: "application/pdf",
    by: "harsha", at: "28 Aug 09:10", key: "demo-UP-002" },
  { id: "UP-001", Scope: "Allotment", Doc_Type: "Payment proof", Investor: "ARL-INV-0208", LLP: "B",
    File_Name: "neft-advance-24aug.png", File_Size: 318_976, File_Type: "image/png",
    by: "meena", at: "24 Aug 11:08", key: "demo-UP-001" },
];

const fin = { user_name: "Growize Finance", email: "finance@agresearchlabs.com" };
const EMAILS: RecEmail[] = [
  { message_id: "EM-0208-3", module: "Contacts", record: "ARL-INV-0208",
    from: { user_name: "Prakash Bhat", email: "prakash.bhat@gmail.com" }, to: [fin],
    subject: "Balance for Block B", sent_time: "30 Aug 18:42",
    content: "Hello,\n\nI will send the balance from my HDFC account in the second week of September, well before the hold ends on 23 Sep. Please confirm the account it should go to.\n\nRegards,\nPrakash" },
  { message_id: "EM-0208-2", module: "Contacts", record: "ARL-INV-0208",
    from: fin, to: [{ user_name: "Prakash Bhat", email: "prakash.bhat@gmail.com" }],
    subject: "Advance received — your reservation on Block B", sent_time: "24 Aug 11:10",
    content: "Dear Prakash,\n\nWe have received your 10% advance. Your unit on Block B is held for you until 23 Sep. The balance is due by then.\n\nGrowize Finance" },
  { message_id: "EM-0208-1", module: "Contacts", record: "ARL-INV-0208",
    from: fin, to: [{ user_name: "Prakash Bhat", email: "prakash.bhat@gmail.com" }],
    subject: "Your supplementary agreement", sent_time: "24 Aug 09:40",
    content: "Dear Prakash,\n\nThank you for signing. The signed supplementary agreement is now on file under your ARL ID.\n\nGrowize Finance" },
  { message_id: "EM-0209-2", module: "Contacts", record: "ARL-INV-0209",
    from: { user_name: "Joseph Mathew", email: "joseph.m@gulfmail.ae" }, to: [fin],
    subject: "Re: FEMA declaration", sent_time: "31 Aug 19:20",
    content: "I have opened the declaration. My DSC token is with my office in Dubai; I will sign it when I am back on Thursday." },
  { message_id: "EM-0209-1", module: "Contacts", record: "ARL-INV-0209",
    from: fin, to: [{ user_name: "Joseph Mathew", email: "joseph.m@gulfmail.ae" }],
    subject: "FEMA declaration for your signature", sent_time: "26 Aug 16:22",
    content: "Dear Joseph,\n\nAs a non-resident holder you need to sign a FEMA declaration before the units can be allotted. It is out for signature with a Class 3 DSC; the link expires on 09 Sep.\n\nGrowize Finance" },
  { message_id: "EM-0205-1", module: "Contacts", record: "ARL-INV-0205",
    from: { user_name: "Radhika Menon", email: "radhika.menon@gmail.com" }, to: [fin],
    subject: "Change of bank account", sent_time: "29 Aug 10:05",
    content: "Please move my payouts to my new account. I have raised it with Imran as well." },
];

/** the Investors side's share of the later stories' demo records */
export const PAPER2 = { SIGN, UPLOADS, EMAILS };
