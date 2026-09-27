/* ── fixtures/book/emails.ts — a lead's emails (M12-S09), not in the prototype ────────────────
   Invented from the story's acceptance criteria on the demo book's fictional leads (lead side:
   28 Aug 2026). The Zoho CRM Emails API shape: from, to, subject, sent_time, content. L6 (Prakash
   Bhat, Rohit's lead) became ARL-INV-0208 and L7 (Joseph Mathew, Kavya's) became ARL-INV-0209.
   ────────────────────────────────────────────────────────────────────────────────────────── */
import type { RecEmail } from "@/lib/im";

const rohit = { user_name: "Rohit Deshpande", email: "rohit@agresearchlabs.com" };
const kavya = { user_name: "Kavya Nair", email: "kavya@agresearchlabs.com" };

export const LEADMAIL: RecEmail[] = [
  { message_id: "EL-L6-2", module: "Leads", record: "L6",
    from: { user_name: "Prakash Bhat", email: "prakash.bhat@gmail.com" }, to: [rohit],
    subject: "Re: Growize — Block B", sent_time: "22 Aug 20:14",
    content: "Rohit,\n\nThanks for the walk-through on Saturday. I would like to go ahead with one unit on Block B. What do you need from me?\n\nPrakash" },
  { message_id: "EL-L6-1", module: "Leads", record: "L6",
    from: rohit, to: [{ user_name: "Prakash Bhat", email: "prakash.bhat@gmail.com" }],
    subject: "Growize — Block B", sent_time: "19 Aug 11:30",
    content: "Dear Prakash,\n\nAs promised, the Block B note and the farm visit dates. Saturday morning works well if you can make it.\n\nRohit" },
  { message_id: "EL-L7-1", module: "Leads", record: "L7",
    from: kavya, to: [{ user_name: "Joseph Mathew", email: "joseph.m@gulfmail.ae" }],
    subject: "Your Growize holding from Dubai", sent_time: "18 Aug 15:05",
    content: "Dear Joseph,\n\nAs an NRI you can hold units; Finance will send a FEMA declaration once you say yes.\n\nKavya" },
  { message_id: "EL-L4-1", module: "Leads", record: "L4",
    from: rohit, to: [{ user_name: "Meera Krishnan", email: "meera.k@gmail.com" }],
    subject: "The pack you asked for", sent_time: "26 Aug 17:45",
    content: "Dear Meera,\n\nThe pack is attached. Happy to talk through any of it this week.\n\nRohit" },
];
