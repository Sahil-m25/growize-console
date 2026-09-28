/* ── fixtures/im/demo.ts — the Investors side's demo book ─────────────────────────────────
   Every record literal below is copied verbatim (by script, not retyped) from the prototype's IMX
   module, /home/claude/ref/imx.js — the line range is noted above each one. The people, investors,
   PANs, accounts and references are the prototype's fictional sample, never real data.
   The clock is the prototype's `TODAY = new Date(2026,8,2)` — 2 September 2026 (imx.js line 131).
   App accounts are not typed: seedApp() derives them from the receipts, as the prototype did.
   ────────────────────────────────────────────────────────────────────────────────────────── */
import {
  seedApp,
  type ImContact, type ImData, type ImDoc, type ImFarm, type ImField, type ImInbox, type ImInvestor,
  type ImIrName, type ImLogEntry, type ImPerson, type ImTicket, type ImTxn, type ImUpdate,
} from "@/lib/im";
import { withMoney } from "./money";
import { PAPER2 } from "./paper2";

/* imx.js lines 82–93 */
const P: Record<string, ImPerson> = {
  harsha :{n:"Harsha Bhat",    i:"HB", r:"head",   c:4, em:"harsha@agresearchlabs.com"},
  meena  :{n:"Meena Raghavan", i:"MR", r:"ops",    c:1, em:"meena@agresearchlabs.com"},
  fahad  :{n:"Fahad Rizvi",    i:"FR", r:"comp",   c:7, em:"fahad@agresearchlabs.com"},
  latha  :{n:"Latha Prabhu",   i:"LP", r:"audit",  c:3, em:"latha@agresearchlabs.com"},
  divya  :{n:"Divya Kamath",   i:"DK", r:"amlead", c:6, em:"divya@agresearchlabs.com"},
  imran  :{n:"Imran Sheikh",   i:"IS", r:"kam",    c:2, em:"imran@agresearchlabs.com"},
  neha   :{n:"Neha Bhandari",  i:"NB", r:"kam",    c:5, em:"neha@agresearchlabs.com"},
  /* the same two people who administer the lead side, because it is the same estate */
  sahil  :{n:"Sahil Mohite",   i:"SM", r:"di",     c:3, em:"sahil@agresearchlabs.com"},
  pradeep:{n:"Pradeep Ram",    i:"PR", r:"root",   c:8, em:"pradeep@agresearchlabs.com"}
};

/* imx.js line 94 */
const SIGNINS = ["harsha","meena","fahad","latha","divya","imran","neha","sahil","pradeep"];

/* imx.js lines 100–108 */
const IRN: Record<string, ImIrName> = {
  rohit  :{n:"Rohit Verma",  i:"RV", x:true},
  kavya  :{n:"Kavya Nair",   i:"KN", x:true},
  ananya :{n:"Ananya Iyer",  i:"AI", x:true},
  nikhil :{n:"Nikhil Rao",   i:"NR", x:true},
  tasneem:{n:"Tasneem Khan", i:"TK", x:true},
  arvind :{n:"Arvind Menon", i:"AM", x:true},
  pradeep:{n:"Pradeep Nair", i:"PN", x:true}
};

/* imx.js lines 205–214 */
const FARMS: ImFarm[] = [
  {k:"A", n:"Block A — Doddaballapura", acres:2.4, units:62, released:62, soil:"Red loam",
   crop:"Alphonso · year 3", by:"harsha", at:"21 Aug 10:40"},
  {k:"B", n:"Block B — Doddaballapura", acres:1.3, units:34, released:34, soil:"Red loam",
   crop:"Alphonso · year 2", by:"harsha", at:"21 Aug 10:40"},
  {k:"C", n:"Block C — Chikkaballapura", acres:2.1, units:54, released:0, soil:"Sandy loam",
   crop:"Prepared, not planted", by:null, at:null},
  {k:"D", n:"Block D — Chikkaballapura", acres:2.2, units:58, released:0, soil:"Sandy loam",
   crop:"Survey pending", by:null, at:null}
];

/* imx.js lines 220–329 */
const INV: ImInvestor[] = [
 {id:"ARL-INV-0205", n:"Radhika Menon", ph:"+91 98450 33021", em:"radhika.menon@gmail.com",
  city:"Bengaluru", addr:"14, 3rd Cross, Indiranagar, Bengaluru 560038", nri:false,
  pan:"AVRPM4471K", aadh:"7712", aref:"UIDAI-2507-889021", kyc:"passed", kycOn:"24 Jul",
  bank:{acct:"50100288714520", ifsc:"HDFC0000512", name:"RADHIKA MENON", drop:"matched"},
  units:4, blocks:{A:4}, st:"allocated", ir:"kavya", src:"Founder network",
  since:"25 Jul", nominee:"S. Menon (spouse)",
  kam:"imran", kamOn:"25 Jul", intro:"26 Jul 11:00"},
 {id:"ARL-INV-0206", n:"Abhijit Sen", ph:"+91 99801 55420", em:"abhijit.sen@corp.in",
  city:"Bengaluru", addr:"Flat 704, Prestige Shantiniketan, Whitefield, Bengaluru 560066", nri:false,
  pan:"BKLPS9920H", aadh:"3348", aref:"UIDAI-2508-771244", kyc:"passed", kycOn:"08 Aug",
  bank:{acct:"00171140002288", ifsc:"ICIC0000017", name:"ABHIJIT SEN", drop:"matched"},
  units:1, blocks:{A:1}, st:"allocated", ir:"rohit", src:"Events",
  since:"08 Aug", nominee:"Rupa Sen (spouse)",
  kam:null, kamOn:null, intro:null},
 {id:"ARL-INV-0207", n:"Meenakshi Sundaram", ph:"+91 94480 71190", em:"meenakshi.s@gmail.com",
  city:"Coimbatore", addr:"22 Race Course Road, Coimbatore 641018", nri:false,
  pan:"AGTPS1180C", aadh:"9014", aref:"UIDAI-2508-812330", kyc:"passed", kycOn:"20 Aug",
  bank:{acct:"38812200091144", ifsc:"SBIN0003881", name:"MEENAKSHI SUNDARAM", drop:"matched"},
  units:2, blocks:{A:2}, st:"allocated", ir:"kavya", src:"Referral — investor",
  since:"20 Aug", nominee:"—",
  kam:"neha", kamOn:"21 Aug", intro:"22 Aug 16:30"},
 {id:"ARL-INV-0208", n:"Prakash Bhat", ph:"+91 97400 55519", em:"prakash.bhat@gmail.com",
  city:"Mysuru", addr:"188, Vijayanagar 2nd Stage, Mysuru 570017", nri:false,
  pan:"AFTPB2214L", aadh:"5561", aref:"UIDAI-2408-660118", kyc:"passed", kycOn:"24 Aug",
  bank:{acct:"91120044771208", ifsc:"HDFC0000911", name:"PRAKASH BHAT", drop:"matched"},
  units:1, blocks:{B:1}, st:"reserved", ir:"rohit", src:"Referral — investor",
  since:"24 Aug", nominee:"Sushma Bhat (spouse)", hold:"23 Sep", lead:"L6"},
 {id:"ARL-INV-0209", n:"Joseph Mathew", ph:"+91 95350 90067", em:"joseph.m@gulfmail.ae",
  city:"Dubai", addr:"Villa 12, Al Barsha 2, Dubai, UAE", nri:true,
  pan:"AJKPM7702D", aadh:null, aref:null, kyc:"pending", kycOn:null,
  bank:{acct:"NRE0099114420", ifsc:"HDFC0000045", name:"JOSEPH MATHEW", drop:"pending"},
  units:4, blocks:{B:4}, st:"reserved", ir:"kavya", src:"Founder network",
  since:"22 Aug", nominee:"—", hold:"21 Sep", lead:"L7",
  fema:"outstanding"},
 {id:"ARL-INV-0210", n:"R. Sundaram", ph:"+91 99458 11207", em:"r.sundaram@gmail.com",
  city:"Bengaluru", addr:"9, Sarjapur Main Road, Bengaluru 560035", nri:false,
  pan:"AMDPS3390F", aadh:"2207", aref:"UIDAI-2408-703992", kyc:"passed", kycOn:"20 Aug",
  bank:{acct:"20440188002211", ifsc:"ICIC0002044", name:"R SUNDARAM", drop:"matched"},
  units:1, blocks:{B:1}, st:"allocated", ir:"kavya", src:"Events",
  since:"20 Aug", nominee:"Latha S (spouse)", lead:"L13",
  kam:null, kamOn:null, intro:null},
 {id:"ARL-INV-0212", n:"Sanjay Kulkarni", ph:"+91 98220 41178", em:"sanjay.kulkarni@gmail.com",
  city:"Pune", addr:"B-1102, Marvel Zephyr, Kharadi, Pune 411014", nri:false,
  pan:"AENPK3391R", aadh:"4402", aref:"UIDAI-2506-540118", kyc:"passed", kycOn:"14 Jun",
  bank:{acct:"50200177441209", ifsc:"HDFC0000342", name:"SANJAY KULKARNI", drop:"matched"},
  units:6, blocks:{A:6}, st:"allocated", ir:"rohit", src:"Referral — investor",
  since:"12 Jun", nominee:"Sujata Kulkarni (spouse)",
  kam:"imran", kamOn:"12 Jun", intro:"14 Jun 10:30"},
 {id:"ARL-INV-0213", n:"Fatima Zaidi", ph:"+91 90000 27714", em:"fatima.zaidi@gmail.com",
  city:"Hyderabad", addr:"8-2-293/A, Road No. 12, Banjara Hills, Hyderabad 500034", nri:false,
  pan:"AHQPZ8802N", aadh:"6619", aref:"UIDAI-2507-601447", kyc:"passed", kycOn:"05 Jul",
  bank:{acct:"62110088332211", ifsc:"SBIN0006211", name:"FATIMA ZAIDI", drop:"matched"},
  units:4, blocks:{A:4}, st:"allocated", ir:"ananya", src:"Events",
  since:"03 Jul", nominee:"Imtiaz Zaidi (spouse)",
  kam:"imran", kamOn:"03 Jul", intro:"05 Jul 16:00"},
 {id:"ARL-INV-0214", n:"Deepak Chandra", ph:"+91 99012 88340", em:"deepak.chandra@gmail.com",
  city:"Bengaluru", addr:"12, Kaggadasapura Main Road, Bengaluru 560093", nri:false,
  pan:"ADRPC5518J", aadh:"1173", aref:"UIDAI-2507-628990", kyc:"passed", kycOn:"19 Jul",
  bank:{acct:"00980140077112", ifsc:"ICIC0000098", name:"DEEPAK CHANDRA", drop:"matched"},
  units:2, blocks:{B:2}, st:"allocated", ir:"kavya", src:"Founder network",
  since:"18 Jul", nominee:"Meera Chandra (spouse)",
  kam:"imran", kamOn:"18 Jul", intro:"20 Jul 11:15"},
 {id:"ARL-INV-0215", n:"Anjali Deshpande", ph:"+91 98200 63391", em:"anjali.deshpande@gmail.com",
  city:"Mumbai", addr:"1804, Oberoi Splendor, Andheri East, Mumbai 400060", nri:false,
  pan:"AKLPD2247B", aadh:"7754", aref:"UIDAI-2506-577201", kyc:"passed", kycOn:"28 Jun",
  bank:{acct:"91180022114477", ifsc:"HDFC0000911", name:"ANJALI DESHPANDE", drop:"matched"},
  units:5, blocks:{A:5}, st:"allocated", ir:"rohit", src:"Referral — investor",
  since:"27 Jun", nominee:"Rohan Deshpande (son)",
  kam:"neha", kamOn:"27 Jun", intro:"29 Jun 18:20"},
 {id:"ARL-INV-0216", n:"Harish Gowda", ph:"+91 94490 33017", em:"harish.gowda@gmail.com",
  city:"Mysuru", addr:"44, Kuvempunagar 2nd Stage, Mysuru 570023", nri:false,
  pan:"AFGPG7719M", aadh:"3390", aref:"UIDAI-2507-612884", kyc:"passed", kycOn:"10 Jul",
  bank:{acct:"38810044229911", ifsc:"SBIN0003881", name:"HARISH GOWDA", drop:"matched"},
  units:2, blocks:{B:2}, st:"allocated", ir:"kavya", src:"Events",
  since:"09 Jul", nominee:"Shobha Gowda (spouse)",
  kam:"neha", kamOn:"09 Jul", intro:"12 Jun 15:40"},
 {id:"ARL-INV-0217", n:"Nirmala Reddy", ph:"+91 98450 71126", em:"nirmala.reddy@gmail.com",
  city:"Bengaluru", addr:"7, Palace Cross Road, Bengaluru 560020", nri:false,
  pan:"ANMPR4408K", aadh:"8871", aref:"UIDAI-2507-655013", kyc:"passed", kycOn:"01 Aug",
  bank:{acct:"20440199113322", ifsc:"ICIC0002044", name:"NIRMALA REDDY", drop:"matched"},
  units:3, blocks:{A:3}, st:"allocated", ir:"ananya", src:"Founder network",
  since:"31 Jul", nominee:"Kiran Reddy (son)",
  kam:"neha", kamOn:"31 Jul", intro:null},
 {id:"ARL-INV-0218", n:"T. Balasubramanian", ph:"+91 90030 55182", em:"t.balasubramanian@gmail.com",
  city:"Chennai", addr:"19, Bazullah Road, T. Nagar, Chennai 600017", nri:false,
  pan:"AGBPB1160D", aadh:"2245", aref:"UIDAI-2507-633710", kyc:"passed", kycOn:"15 Jul",
  bank:{acct:"11440077882200", ifsc:"KKBK0001144", name:"T BALASUBRAMANIAN", drop:"matched"},
  units:1, blocks:{B:1}, st:"allocated", ir:"rohit", src:"Events",
  since:"14 Jul", nominee:"Lakshmi B (spouse)",
  kam:null, kamOn:null, intro:null},
 /* Paid three days ago. Her mark is permanent and still inside the week it can be taken back
    in — the one state in this book you cannot reach by waiting. */
 {id:"ARL-INV-0219", n:"Ritu Malhotra", ph:"+91 98110 20064", em:"ritu.malhotra@gmail.com",
  city:"Delhi", addr:"D-42, Defence Colony, New Delhi 110024", nri:false,
  pan:"ARMPM9903L", aadh:"5028", aref:"UIDAI-2508-681192", kyc:"passed", kycOn:"11 Aug",
  bank:{acct:"00171144003399", ifsc:"ICIC0000017", name:"RITU MALHOTRA", drop:"matched"},
  units:1, blocks:{A:1}, st:"allocated", ir:"kavya", src:"Referral — investor",
  since:"30 Aug", nominee:"Vikas Malhotra (spouse)",
  kam:null, kamOn:null, intro:null},
 /* Allotted a fortnight ago and nobody has been named on it — the case the whole tier rule exists
    to catch, and the one that is invisible unless something goes looking for it. */
 {id:"ARL-INV-0211", n:"Vikram Anand", ph:"+91 98860 71145", em:"vikram.anand@corp.in",
  city:"Bengaluru", addr:"41, Dollars Colony, RMV Extension, Bengaluru 560094", nri:false,
  pan:"AKQPA6612M", aadh:"8830", aref:"UIDAI-2508-844021", kyc:"passed", kycOn:"19 Aug",
  bank:{acct:"11220033445566", ifsc:"KKBK0000112", name:"VIKRAM ANAND", drop:"matched"},
  units:3, blocks:{A:3}, st:"allocated", ir:"ananya", src:"Events",
  since:"21 Aug", nominee:"Sunita Anand (spouse)",
  kam:null, kamOn:null, intro:null}
];

/* imx.js lines 362–397 */
const CONTACT: ImContact[] = [
 {inv:"ARL-INV-0213", at:"24 Jul 10:15", by:"imran", ch:"call", mood:"concern",
  note:"Asked twice why the year-2 note was later than the year-3 note. Not satisfied with the answer. Wants the reporting calendar in writing before the next call."},
 {inv:"ARL-INV-0213", at:"05 Jul 16:00", by:"imran", ch:"call", mood:"good",
  note:"Introduction call. Handed over from Ananya, who stayed on for the first ten minutes."},
 {inv:"ARL-INV-0212", at:"19 Aug 11:45", by:"imran", ch:"visit", mood:"good",
  note:"Walked Block A with him. Asked about the year-4 projection and whether units can be gifted to his daughter — said he would send the question in writing."},
 {inv:"ARL-INV-0212", at:"20 Jul 10:00", by:"imran", ch:"call", mood:"good",
  note:"Quarterly check. Nothing outstanding."},
 {inv:"ARL-INV-0212", at:"14 Jun 10:30", by:"imran", ch:"call", mood:"good",
  note:"Introduction call. Handed over from Rohit on the same call."},
 {inv:"ARL-INV-0214", at:"21 Jul 09:30", by:"imran", ch:"email", mood:"ok",
  note:"Sent the flowering note he asked for. Short reply, no questions."},
 {inv:"ARL-INV-0214", at:"20 Jul 11:15", by:"imran", ch:"call", mood:"good",
  note:"Introduction call."},
 {inv:"ARL-INV-0215", at:"29 Aug 17:10", by:"neha", ch:"call", mood:"good",
  note:"Wants to add a second unit after the year-3 harvest report. Told her the block position and that nothing is reserved on a conversation."},
 {inv:"ARL-INV-0215", at:"28 Jul 16:00", by:"neha", ch:"call", mood:"good",
  note:"Monthly check. Asked for the payout calendar."},
 {inv:"ARL-INV-0215", at:"29 Jun 18:20", by:"neha", ch:"call", mood:"good",
  note:"Introduction call. Handed over from Rohit."},
 {inv:"ARL-INV-0216", at:"12 Jun 15:40", by:"neha", ch:"call", mood:"ok",
  note:"Introduction call, before he was formally handed over. Wanted a farm visit in the monsoon and was told to wait for the dry weeks."},
 {inv:"ARL-INV-0218", at:"20 Jul 12:30", by:"divya", ch:"email", mood:"ok",
  note:"Welcome note and the app invite. Replied to say thank you."},
 {inv:"ARL-INV-0205", at:"28 Jul 11:20", by:"imran", ch:"call",  mood:"good",
  note:"Walked her through the Block A flowering note. Asked whether a second unit is possible "
   +"before the next harvest — said she would think about it."},
 {inv:"ARL-INV-0205", at:"26 Jul 11:00", by:"imran", ch:"call",  mood:"good",
  note:"Introduction call. Handed over from Kavya, who stayed on for the first ten minutes."},
 {inv:"ARL-INV-0207", at:"22 Aug 16:30", by:"neha",  ch:"call",  mood:"ok",
  note:"Introduction call. Wanted to know when the first payout lands — answered, and opened "
   +"TK-0111 so the answer is on her record."},
 {inv:"ARL-INV-0210", at:"29 Aug 11:00", by:"divya", ch:"visit", mood:"good",
  note:"Onboarding walkthrough on the farm. Brought his brother, who asked for a deck."}
];

/* imx.js lines 447–478 */
const TXN: ImTxn[] = [
 {id:"T-0041", inv:"ARL-INV-0212", kind:"full",    amt:15000000, mode:"RTGS",  utr:"HDFC1206771",
  on:"14 Jun 11:20", by:"harsha", rec:"matched"},
 {id:"T-0042", inv:"ARL-INV-0213", kind:"full",    amt:10000000, mode:"NEFT",  utr:"SBIN0507220",
  on:"05 Jul 10:05", by:"harsha", rec:"matched"},
 {id:"T-0043", inv:"ARL-INV-0214", kind:"full",    amt:5000000, mode:"RTGS",  utr:"ICIC1807551",
  on:"19 Jul 15:45", by:"meena", rec:"matched"},
 {id:"T-0044", inv:"ARL-INV-0215", kind:"full",    amt:12500000, mode:"RTGS",  utr:"HDFC2706118",
  on:"28 Jun 12:10", by:"harsha", rec:"matched"},
 {id:"T-0045", inv:"ARL-INV-0216", kind:"full",    amt:5000000, mode:"NEFT",  utr:"SBIN0907442",
  on:"10 Jul 09:50", by:"meena", rec:"matched"},
 {id:"T-0046", inv:"ARL-INV-0217", kind:"full",    amt:7500000, mode:"RTGS",  utr:"ICIC3107993",
  on:"01 Aug 14:05", by:"harsha", rec:"matched"},
 {id:"T-0047", inv:"ARL-INV-0218", kind:"full",    amt:2500000, mode:"NEFT",  utr:"KKBK1407220",
  on:"15 Jul 16:30", by:"meena", rec:"matched"},
 {id:"T-0048", inv:"ARL-INV-0219", kind:"full",    amt:2500000, mode:"RTGS",  utr:"ICIC3008117",
  on:"30 Aug 11:40", by:"harsha", rec:"matched"},
 {id:"T-0032", inv:"ARL-INV-0211", kind:"full",    amt:7500000, mode:"RTGS",  utr:"KKBK2108771",
  on:"21 Aug 12:40", by:"harsha", rec:"matched"},
 {id:"T-0031", inv:"ARL-INV-0210", kind:"full",    amt:2500000, mode:"RTGS",  utr:"ICIC2508430",
  on:"20 Aug 14:30", by:"harsha", rec:"matched"},
 {id:"T-0030", inv:"ARL-INV-0209", kind:"advance", amt:1000000, mode:"SWIFT", utr:"EMIR2608119",
  on:"22 Aug 11:15", by:"meena",  rec:"matched", note:"NRE inward · FIRC awaited"},
 {id:"T-0029", inv:"ARL-INV-0208", kind:"advance", amt:250000,  mode:"NEFT",  utr:"HDFC2608551",
  on:"24 Aug 11:06", by:"meena",  rec:"matched"},
 {id:"T-0028", inv:"ARL-INV-0207", kind:"full",    amt:5000000, mode:"NEFT",  utr:"HDFC0092271145",
  on:"20 Aug 14:55", by:"harsha", rec:"matched"},
 {id:"T-0027", inv:"ARL-INV-0206", kind:"full",    amt:2500000, mode:"RTGS",  utr:"ICIC0088140233",
  on:"08 Aug 10:12", by:"harsha", rec:"matched"},
 {id:"T-0026", inv:"ARL-INV-0205", kind:"full",    amt:10000000,mode:"NEFT",  utr:"HDFC0088012477",
  on:"24 Jul 15:31", by:"harsha", rec:"matched"}
];

/* imx.js lines 492–583 */
const DOCS: ImDoc[] = [
 {id:"D-001", inv:"ARL-INV-0212", t:"Non-disclosure agreement", cls:"Confidentiality", state:"signed",
  sent:"28 May 09:30", by:"meena", sig:"Aadhaar OTP", ref:"EMU-2805-41120", on:"28 May 17:10"},
 {id:"D-002", inv:"ARL-INV-0212", t:"Supplementary agreement", cls:"Commercial", state:"signed",
  sent:"06 Jun 10:15", by:"harsha", sig:"Aadhaar OTP", ref:"EMU-0606-44380", on:"08 Jun 11:25"},
 {id:"D-003", inv:"ARL-INV-0212", t:"Allocation letter", cls:"Commercial", state:"signed",
  sent:"14 Jun 12:00", by:"harsha", sig:"Aadhaar OTP", ref:"EMU-1406-46990", on:"14 Jun 13:40"},
 {id:"D-004", inv:"ARL-INV-0213", t:"Non-disclosure agreement", cls:"Confidentiality", state:"signed",
  sent:"18 Jun 08:40", by:"meena", sig:"Aadhaar OTP", ref:"EMU-1806-48210", on:"18 Jun 19:05"},
 {id:"D-005", inv:"ARL-INV-0213", t:"Supplementary agreement", cls:"Commercial", state:"signed",
  sent:"27 Jun 09:55", by:"harsha", sig:"Aadhaar OTP", ref:"EMU-2706-50440", on:"29 Jun 10:12"},
 {id:"D-006", inv:"ARL-INV-0213", t:"Allocation letter", cls:"Commercial", state:"signed",
  sent:"05 Jul 11:00", by:"harsha", sig:"Aadhaar OTP", ref:"EMU-0507-52880", on:"05 Jul 12:30"},
 {id:"D-007", inv:"ARL-INV-0214", t:"Non-disclosure agreement", cls:"Confidentiality", state:"signed",
  sent:"02 Jul 10:20", by:"meena", sig:"Aadhaar OTP", ref:"EMU-0207-52010", on:"02 Jul 15:35"},
 {id:"D-008", inv:"ARL-INV-0214", t:"Supplementary agreement", cls:"Commercial", state:"signed",
  sent:"12 Jul 09:30", by:"harsha", sig:"Aadhaar OTP", ref:"EMU-1207-53770", on:"14 Jul 09:55"},
 {id:"D-009", inv:"ARL-INV-0214", t:"Allocation letter", cls:"Commercial", state:"signed",
  sent:"19 Jul 16:00", by:"harsha", sig:"Aadhaar OTP", ref:"EMU-1907-55620", on:"19 Jul 17:20"},
 {id:"D-010", inv:"ARL-INV-0215", t:"Non-disclosure agreement", cls:"Confidentiality", state:"signed",
  sent:"11 Jun 09:05", by:"meena", sig:"Aadhaar OTP", ref:"EMU-1106-45330", on:"11 Jun 14:40"},
 {id:"D-011", inv:"ARL-INV-0215", t:"Supplementary agreement", cls:"Commercial", state:"signed",
  sent:"20 Jun 10:40", by:"harsha", sig:"Aadhaar OTP", ref:"EMU-2006-47510", on:"22 Jun 09:20"},
 {id:"D-012", inv:"ARL-INV-0215", t:"Allocation letter", cls:"Commercial", state:"signed",
  sent:"28 Jun 12:25", by:"harsha", sig:"Aadhaar OTP", ref:"EMU-2806-50990", on:"28 Jun 14:05"},
 {id:"D-013", inv:"ARL-INV-0216", t:"Non-disclosure agreement", cls:"Confidentiality", state:"signed",
  sent:"23 Jun 08:55", by:"meena", sig:"Aadhaar OTP", ref:"EMU-2306-49120", on:"23 Jun 18:30"},
 {id:"D-014", inv:"ARL-INV-0216", t:"Supplementary agreement", cls:"Commercial", state:"signed",
  sent:"02 Jul 11:10", by:"harsha", sig:"Aadhaar OTP", ref:"EMU-0207-52050", on:"04 Jul 10:45"},
 {id:"D-015", inv:"ARL-INV-0216", t:"Allocation letter", cls:"Commercial", state:"signed",
  sent:"10 Jul 10:05", by:"harsha", sig:"Aadhaar OTP", ref:"EMU-1007-53330", on:"10 Jul 11:50"},
 {id:"D-016", inv:"ARL-INV-0217", t:"Non-disclosure agreement", cls:"Confidentiality", state:"signed",
  sent:"15 Jul 09:15", by:"meena", sig:"Aadhaar OTP", ref:"EMU-1507-54880", on:"15 Jul 16:20"},
 {id:"D-017", inv:"ARL-INV-0217", t:"Supplementary agreement", cls:"Commercial", state:"signed",
  sent:"24 Jul 10:00", by:"harsha", sig:"Aadhaar OTP", ref:"EMU-2407-57110", on:"26 Jul 09:40"},
 {id:"D-018", inv:"ARL-INV-0217", t:"Allocation letter", cls:"Commercial", state:"signed",
  sent:"01 Aug 14:20", by:"harsha", sig:"Aadhaar OTP", ref:"EMU-0108-59770", on:"01 Aug 15:35"},
 {id:"D-019", inv:"ARL-INV-0218", t:"Non-disclosure agreement", cls:"Confidentiality", state:"signed",
  sent:"29 Jun 09:40", by:"meena", sig:"Aadhaar OTP", ref:"EMU-2906-51220", on:"29 Jun 20:10"},
 {id:"D-020", inv:"ARL-INV-0218", t:"Supplementary agreement", cls:"Commercial", state:"signed",
  sent:"08 Jul 10:30", by:"harsha", sig:"Aadhaar OTP", ref:"EMU-0807-53010", on:"10 Jul 11:15"},
 {id:"D-021", inv:"ARL-INV-0218", t:"Allocation letter", cls:"Commercial", state:"signed",
  sent:"15 Jul 17:00", by:"harsha", sig:"Aadhaar OTP", ref:"EMU-1507-54990", on:"15 Jul 18:10"},
 {id:"D-022", inv:"ARL-INV-0219", t:"Non-disclosure agreement", cls:"Confidentiality", state:"signed",
  sent:"12 Aug 08:50", by:"meena", sig:"Aadhaar OTP", ref:"EMU-1208-56330", on:"12 Aug 15:05"},
 {id:"D-023", inv:"ARL-INV-0219", t:"Supplementary agreement", cls:"Commercial", state:"signed",
  sent:"21 Aug 09:20", by:"harsha", sig:"Aadhaar OTP", ref:"EMU-2108-58440", on:"22 Aug 10:50"},
 {id:"D-024", inv:"ARL-INV-0219", t:"Allocation letter", cls:"Commercial", state:"signed",
  sent:"30 Aug 11:55", by:"harsha", sig:"Aadhaar OTP", ref:"EMU-3008-60880", on:"30 Aug 13:15"},
 {id:"D-044", inv:"ARL-INV-0211", t:"Allocation letter", cls:"Commercial", state:"signed",
  sent:"21 Aug 13:05", by:"harsha", sig:"Aadhaar OTP", ref:"EMU-2108-72880", on:"21 Aug 14:10"},
 {id:"D-043", inv:"ARL-INV-0211", t:"Supplementary agreement", cls:"Commercial", state:"signed",
  sent:"14 Aug 10:20", by:"harsha", sig:"Aadhaar OTP", ref:"EMU-1408-70020", on:"15 Aug 09:30"},
 {id:"D-042", inv:"ARL-INV-0211", t:"Non-disclosure agreement", cls:"Confidentiality", state:"signed",
  sent:"04 Aug 09:10", by:"meena", sig:"Aadhaar OTP", ref:"EMU-0408-65510", on:"04 Aug 16:44"},
 {id:"D-041", inv:"ARL-INV-0209", t:"FEMA declaration", cls:"Regulatory", state:"awaiting",
  sent:"26 Aug 16:20", by:"meena", sig:"Class 3 DSC", ref:null, exp:"09 Sep"},
 {id:"D-040", inv:"ARL-INV-0209", t:"Supplementary agreement", cls:"Commercial", state:"signed",
  sent:"19 Aug 18:40", by:"harsha", sig:"Class 3 DSC", ref:"EMU-1908-70551", on:"22 Aug 09:10"},
 {id:"D-039", inv:"ARL-INV-0209", t:"Non-disclosure agreement", cls:"Confidentiality", state:"signed",
  sent:"05 Aug 08:06", by:"meena", sig:"Class 3 DSC", ref:"EMU-0508-66120", on:"06 Aug 14:22"},
 {id:"D-038", inv:"ARL-INV-0208", t:"Advance receipt", cls:"Financial", state:"issued",
  sent:"25 Aug 09:02", by:"meena", sig:null, ref:"RCT-2508-0208"},
 {id:"D-037", inv:"ARL-INV-0208", t:"Supplementary agreement", cls:"Commercial", state:"signed",
  sent:"12 Aug 17:00", by:"harsha", sig:"Aadhaar OTP", ref:"EMU-2608-77120", on:"24 Aug 11:06"},
 {id:"D-036", inv:"ARL-INV-0208", t:"Non-disclosure agreement", cls:"Confidentiality", state:"signed",
  sent:"02 Aug 10:22", by:"meena", sig:"Aadhaar OTP", ref:"EMU-0208-64008", on:"03 Aug 09:40"},
 {id:"D-035b", inv:"ARL-INV-0210", t:"Non-disclosure agreement", cls:"Confidentiality", state:"signed",
  sent:"09 Jul 11:20", by:"meena", sig:"Aadhaar OTP", ref:"EMU-0907-58440", on:"10 Jul 09:02"},
 {id:"D-035", inv:"ARL-INV-0210", t:"Allocation letter", cls:"Commercial", state:"signed",
  sent:"21 Jul 10:12", by:"harsha", sig:"Aadhaar OTP", ref:"EMU-2508-71004", on:"22 Jul 11:30"},
 {id:"D-034", inv:"ARL-INV-0210", t:"Supplementary agreement", cls:"Commercial", state:"signed",
  sent:"18 Jul 16:00", by:"harsha", sig:"Aadhaar OTP", ref:"EMU-1807-69912", on:"19 Jul 10:05"},
 {id:"D-033b", inv:"ARL-INV-0207", t:"Non-disclosure agreement", cls:"Confidentiality", state:"signed",
  sent:"20 Jul 09:19", by:"meena", sig:"Aadhaar OTP", ref:"EMU-2007-61220", on:"20 Jul 12:04"},
 {id:"D-033c", inv:"ARL-INV-0207", t:"Supplementary agreement", cls:"Commercial", state:"signed",
  sent:"15 Aug 10:00", by:"harsha", sig:"Aadhaar OTP", ref:"EMU-1508-70110", on:"16 Aug 09:22"},
 {id:"D-033", inv:"ARL-INV-0207", t:"Allocation letter", cls:"Commercial", state:"signed",
  sent:"20 Aug 16:20", by:"harsha", sig:"Aadhaar OTP", ref:"EMU-2008-72110", on:"20 Aug 17:40"},
 {id:"D-032b", inv:"ARL-INV-0206", t:"Non-disclosure agreement", cls:"Confidentiality", state:"signed",
  sent:"16 Jul 18:01", by:"meena", sig:"Aadhaar OTP", ref:"EMU-1607-60114", on:"17 Jul 08:40"},
 {id:"D-032c", inv:"ARL-INV-0206", t:"Supplementary agreement", cls:"Commercial", state:"signed",
  sent:"01 Aug 11:30", by:"harsha", sig:"Aadhaar OTP", ref:"EMU-0108-67200", on:"02 Aug 10:15"},
 {id:"D-032", inv:"ARL-INV-0206", t:"Allocation letter", cls:"Commercial", state:"signed",
  sent:"08 Aug 11:40", by:"harsha", sig:"Aadhaar OTP", ref:"EMU-0808-68440", on:"08 Aug 12:10"},
 {id:"D-031b", inv:"ARL-INV-0205", t:"Non-disclosure agreement", cls:"Confidentiality", state:"signed",
  sent:"02 Jul 09:40", by:"meena", sig:"Aadhaar OTP", ref:"EMU-0207-57880", on:"02 Jul 14:20"},
 {id:"D-031c", inv:"ARL-INV-0205", t:"Supplementary agreement", cls:"Commercial", state:"signed",
  sent:"18 Jul 15:31", by:"harsha", sig:"Aadhaar OTP", ref:"EMU-1807-59902", on:"19 Jul 11:05"},
 {id:"D-031", inv:"ARL-INV-0205", t:"Allocation letter", cls:"Commercial", state:"signed",
  sent:"25 Jul 09:14", by:"harsha", sig:"Aadhaar OTP", ref:"EMU-2507-63021", on:"25 Jul 10:02"}
];

/* imx.js lines 604–618 */
const INBOX: ImInbox[] = [
 {id:"N-08", inv:"ARL-INV-0208", kind:"claim", at:"27 Aug 17:35", ir:"rohit", state:"open",
  t:"The investor says he has paid", d:"In full, ₹25 L, RTGS HDFC2708994. Says he sent it Friday "
   +"evening, before the hold runs out."},
 {id:"N-07", inv:"ARL-INV-0209", kind:"chase", at:"26 Aug 16:25", ir:"kavya", state:"seen",
  t:"Chased the FEMA declaration", d:"Emails ×2 · Calls ×1 · last 26 Aug. He says his DSC token "
   +"expired and he is renewing it this week."},
 {id:"N-06", inv:"ARL-INV-0209", kind:"told", at:"19 Aug 18:45", ir:"kavya", state:"seen",
  t:"Told the investor the supplementary went", d:"By call, same evening."},
 {id:"N-05", inv:"ARL-INV-0208", kind:"signed", doc:"supp", at:"24 Aug 10:50", ir:"rohit",
  state:"seen", t:"They say the supplementary is signed and sent",
  d:"Verified here the same morning."},
 {id:"N-04", inv:"ARL-INV-0210", kind:"note", at:"20 Aug 14:35", ir:"kavya", state:"seen",
  t:"Onboarding call booked", d:"App access walkthrough, 29 Aug 11:00."}
];

/* imx.js lines 634–671 */
const TKT: ImTicket[] = [
 /* The investor told her manager, because her manager is who she talks to. He cannot see a bank
    account and should not, so what he can do is take the request and hand it over — which keeps
    him able to answer "where has my request got to" without ever seeing the number. */
 {id:"TK-0114", inv:"ARL-INV-0205", t:"Change the bank account for payouts", cat:"Bank",
  opened:"29 Aug 10:20", by:"investor", own:"imran", pri:"high", state:"open",
  d:"Wants payouts moved to her HDFC account. New account and a cancelled cheque attached.",
  sla:"2 working days"},
 /* Two tickets on Radhika Menon, deliberately. Moving the account money leaves from is a
    compliance job and belongs to Finance; asking for the harvest note is a conversation and
    belongs to the manager who has that conversation every month. Same investor, same week, two
    seats — which is the whole reason the category sits on every row. */
 {id:"TK-0116", inv:"ARL-INV-0205", t:"Wants the Block A harvest note for her brother", cat:"Query",
  opened:"30 Aug 09:15", by:"investor", own:"imran", pri:"normal", state:"open",
  d:"He came on the last farm visit and asked for a deck. She wants the flowering note and the "
   +"year-3 projection in one place before she introduces him.", sla:"5 working days"},
 {id:"TK-0117", inv:"ARL-INV-0212", t:"New address after a move to Baner", cat:"Records",
  opened:"01 Sep 12:05", by:"investor", own:"imran", pri:"normal", state:"open",
  d:"Moved last month. Wants the address on the record and on the statement updated before the "
   +"quarterly goes out.", sla:"5 working days"},
 {id:"TK-0115", inv:"ARL-INV-0207", t:"Asked to move her quarterly call to evenings", cat:"Query",
  opened:"28 Aug 18:40", by:"investor", own:"neha", pri:"normal", state:"waiting",
  d:"Cannot take a call before 7pm on weekdays. Waiting on her to confirm a slot.",
  sla:"5 working days"},
 {id:"TK-0113", inv:"ARL-INV-0209", t:"FIRC copy for the inward remittance", cat:"Compliance",
  opened:"28 Aug 15:05", by:"investor", own:"fahad", pri:"high", state:"open",
  d:"His CA needs the FIRC for the ₹10 L that came in on 22 Aug.", sla:"3 working days"},
 {id:"TK-0112", inv:"ARL-INV-0206", t:"Add a nominee", cat:"Records",
  opened:"27 Aug 09:40", by:"investor", own:"meena", pri:"normal", state:"waiting",
  d:"Nominee form sent; waiting on the signed copy.", sla:"5 working days"},
 {id:"TK-0111", inv:"ARL-INV-0207", t:"When is the first payout?", cat:"Query",
  opened:"25 Aug 16:10", by:"investor", own:"harsha", pri:"normal", state:"closed",
  d:"Answered: first distribution follows the year-3 harvest on Block A.", sla:"3 working days",
  closed:"26 Aug 11:00"},
 {id:"TK-0110", inv:"ARL-INV-0210", t:"App login not working", cat:"Access",
  opened:"22 Aug 11:30", by:"ir", own:"meena", pri:"normal", state:"closed",
  d:"Invite had gone to an old address. Re-sent.", sla:"1 working day", closed:"22 Aug 15:00"}
];

/* imx.js lines 682–700 */
const FIELD: ImField[] = [
 {id:"F-06", blk:"A", at:"28 Aug 08:40", by:"divya", st:"Flowering", head:"Flowering nine days early",
  d:"Panicle emergence across the north half. Agronomy note filed; no change to the harvest window "
   +"yet, and nothing has been promised to anybody about volume."},
 {id:"F-05", blk:"B", at:"21 Aug 16:10", by:"imran", st:"Year 2 — growth", head:"Drip line repaired on rows 14–19",
  d:"Six rows were under-watering for about a fortnight. Repaired the same day. Two investors were "
   +"walking the block when it was found, which is why it is written down."},
 {id:"F-04", blk:"A", at:"12 Aug 09:20", by:"neha", st:"Year 3 — bearing", head:"Second round of pruning done",
  d:"Canopy opened on the older rows. Photographs on the portal."},
 {id:"F-03", blk:"C", at:"04 Aug 11:00", by:"divya", st:"Prepared, not planted",
  head:"Soil test back — sandy loam confirmed",
  d:"Organic carbon low but workable with the planned amendment. Nothing here is sellable and the "
   +"shelf still reads zero, which is correct."},
 {id:"F-02", blk:"B", at:"22 Jul 07:50", by:"imran", st:"Year 2 — growth", head:"Inter-crop cleared",
  d:"Ground cover removed ahead of the monsoon."},
 {id:"F-01", blk:"A", at:"09 Jul 15:30", by:"neha", st:"Year 3 — bearing", head:"Farm visit — four investors",
  d:"Walked the block with four holders. Two asked about the year-4 projection; both were told the "
   +"same thing, which is that it is not published yet."}
];

/* imx.js lines 754–766 */
const UPD: ImUpdate[] = [
 {id:"U-09", t:"Block A — year-3 flowering ahead of schedule", cat:"Produce", on:"28 Aug 09:00",
  by:"harsha", to:"allocated", n:7,
  d:"Flowering began nine days early across Block A. No change to the harvest window yet; the "
   +"agronomy note is on the portal."},
 {id:"U-08", t:"Quarterly statement — Jul to Sep", cat:"Statement", on:"25 Aug 10:00",
  by:"meena", to:"all", n:6,
  d:"Statements for the quarter will be issued on 5 October, covering units held on 30 September."},
 {id:"U-07", t:"FEMA declarations — NRI investors", cat:"Compliance", on:"20 Aug 11:20",
  by:"fahad", to:"nri", n:1,
  d:"A signed FEMA declaration is needed before allotment for every NRI holding. Class 3 DSC or a "
   +"wet signature; Aadhaar OTP will not work from outside India."}
];

/* imx.js lines 776–801 */
const LOG: ImLogEntry[] = [
 {at:"29 Aug 10:22", who:"meena",  what:"Opened a ticket", inv:"ARL-INV-0205",
  note:"TK-0114 · bank account change", kind:"tkt"},
 {at:"28 Aug 15:06", who:"fahad",  what:"Opened a ticket", inv:"ARL-INV-0209",
  note:"TK-0113 · FIRC copy", kind:"tkt"},
 {at:"28 Aug 09:00", who:"harsha", what:"Published an update", inv:null,
  note:"Block A — year-3 flowering ahead of schedule · 7 investors", kind:"upd"},
 {at:"26 Aug 16:20", who:"meena",  what:"Sent document", inv:"ARL-INV-0209",
  note:"FEMA declaration · Class 3 DSC", kind:"doc"},
 {at:"25 Aug 10:00", who:"meena",  what:"Published an update", inv:null,
  note:"Quarterly statement — Jul to Sep · 6 investors", kind:"upd"},
 {at:"24 Aug 11:06", who:"meena",  what:"Recorded a receipt", inv:"ARL-INV-0208",
  note:"10% advance · ₹2,50,000 · NEFT HDFC2608551", kind:"money"},
 {at:"24 Aug 11:04", who:"meena",  what:"Verified the signed copy", inv:"ARL-INV-0208",
  note:"Supplementary agreement · EMU-2608-77120", kind:"doc"},
 {at:"24 Aug 09:15", who:"fahad",  what:"Passed KYC", inv:"ARL-INV-0208",
  note:"PAN verified, Aadhaar matched", kind:"kyc"},
 {at:"22 Aug 11:15", who:"meena",  what:"Recorded a receipt", inv:"ARL-INV-0209",
  note:"10% advance · ₹10,00,000 · SWIFT EMIR2608119", kind:"money"},
 {at:"21 Aug 10:40", who:"harsha", what:"Released land", inv:null,
  note:"Blocks A and B confirmed deliverable · 96 units sellable", kind:"farm"},
 {at:"20 Aug 14:30", who:"harsha", what:"Recorded a receipt", inv:"ARL-INV-0210",
  note:"Paid in full · ₹25,00,000 · RTGS ICIC2508430", kind:"money"},
 {at:"20 Aug 11:20", who:"fahad",  what:"Published an update", inv:null,
  note:"FEMA declarations — NRI investors · 1 investor", kind:"upd"}
];

/** The Investors side on 2 Sep 2026: every demo record, with the app accounts seeded from the receipts. */
export function imDemoData(): ImData {
  return withMoney(seedApp(structuredClone({
    NOW: "2026-09-02T00:00",
    P, SIGNINS, IRN, FARMS, INV, CONTACT, TXN, DOCS, INBOX, TKT, FIELD, UPD, LOG,
    ANS: {}, OUTBOX: [], APP: {},
    ...PAPER2,   /* uploads, Zoho Sign status, emails (M12-S02/S05/S09) — ./paper2.ts */
    /* the prototype's sequence counters: TSEQ 48 (l.487), DSEQ 44 (l.595), KSEQ 117 (l.675),
       FSEQ 6 (l.701), USEQ 9 (l.767) */
    TSEQ: 48, DSEQ: 44, KSEQ: 117, FSEQ: 6, USEQ: 9,
  })));
}
