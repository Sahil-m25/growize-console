/**
 * The field events. Ports `ref/03-app.js` lines 911-919.
 *
 * `off` is what the event's own sheet claims it captured on the day. Everything else about an
 * event — qualified, reserved, paid — comes from the leads themselves, so nothing is typed twice.
 */

import type { EventRec, SheetCol, SheetRec } from "./types";

export const EVENTS: EventRec[] = [
 {id:"E-04",n:"Prestige Falcon City",   type:"Society",ch:"MyGate", date:"23–24 Aug",city:"Bengaluru",cost:74000, staff:["kavya","rohit","nikhil"],  state:"done",    off:38},
 {id:"E-03",n:"Koramangala Club",       type:"Club",   ch:"Direct", date:"16–17 Aug",city:"Bengaluru",cost:96000, staff:["ananya","rohit"],          state:"done",    off:26},
 {id:"E-02",n:"Brigade Cornerstone",    type:"Society",ch:"MyGate", date:"9–10 Aug", city:"Bengaluru",cost:68000, staff:["kavya","ananya"],          state:"done",    off:31},
 {id:"E-01",n:"AgriTech Expo",          type:"Partner",ch:"Partner",date:"2–3 Aug",  city:"Bengaluru",cost:152000,staff:["kavya","rohit","ananya"],  state:"done",    off:44},
 {id:"E-05",n:"Sobha Dream Acres",      type:"Society",ch:"MyGate", date:"5–6 Sep",  city:"Bengaluru",cost:70000, staff:["kavya","nikhil"],          state:"planned", off:0},
 {id:"E-06",n:"Bangalore Club",         type:"Club",   ch:"Direct", date:"19–20 Sep",city:"Bengaluru",cost:95000, staff:["rohit"],                   state:"planned", off:0},
 {id:"E-07",n:"Embassy Springs",        type:"Society",ch:"MyGate", date:"26–27 Sep",city:"Bengaluru",cost:70000, staff:["ananya","nikhil"],         state:"planned", off:0}
];

/* ---- the event sheet. One tab per event, loaded in a single pass. ---- */
export const SHEETCOLS: readonly SheetCol[] = [
  {k:"name",  t:"Full name",  req:true,  note:"as they said it"},
  {k:"mobile",t:"Mobile",     req:true,  note:"10 digits, we add +91"},
  {k:"email", t:"Email",      req:false, note:"blank is allowed"},
  {k:"units", t:"Units",      req:false, note:"1–10, blank means not said"},
  {k:"consent",t:"Consent",   req:true,  note:"WhatsApp / Call / Email, comma separated"},
  {k:"note",  t:"Note",       req:false, note:"anything the IR wrote on the tablet"}
];
/* a real sheet's worth of outcomes, so the preview shows what actually happens */
export const SHEET: Record<string, SheetRec> = {"E-04":{rows:38, ok:31, dupe:4, bad:3, at:"24 Aug 21:10", by:"kavya", state:"ready"},
               "E-03":{rows:26, ok:26, dupe:0, bad:0, at:"17 Aug 20:44", by:"ananya", state:"loaded"},
               "E-02":{rows:31, ok:29, dupe:2, bad:0, at:"10 Aug 19:02", by:"kavya",  state:"loaded"},
               "E-01":{rows:44, ok:41, dupe:1, bad:2, at:"03 Aug 22:15", by:"rohit",  state:"loaded"}};
/** How a loaded sheet hands its rows out. */
export const ASSIGNRULE: Record<string, string> = {roster:"Round-robin across who staffed it", self:"All to me",
                    one:"All to one person", none:"Leave unassigned"};
/* names for the rows the sheet is standing in for, so a load produces real leads to open */
export const SHEETNAMES = ["Aarti Bhandari","Suresh Kamath","Nithya Raghavan","Imran Qadri","Lalitha Rao",
  "Devendra Joshi","Fatima Sheikh","Karthik Subramanian","Vaishali Pawar","Mohan Gowda",
  "Reshma D'Souza","Anirudh Bhatt","Sneha Kulkarni","Jayant Prabhu","Zoya Merchant",
  "Ramesh Achar","Divya Nambiar","Prasad Hegde","Naila Ansari","Girish Kamble",
  "Sudha Venkatesh","Manoj Tandon","Preeti Salian","Harsha Vardhan","Kiran Bopanna",
  "Leela Krishnan","Vivek Menon","Tara Chandran","Ashok Pai","Meher Irani","Sanjeev Nayak"] as const;
export const SHEETNOTES = ["Asked about the water table.","Comparing against a 3-year FD.",
  "Wants a site visit before anything.","Son handles the investments — send to him.",
  "Only free on Sundays.","Wants the yield note first."] as const;
