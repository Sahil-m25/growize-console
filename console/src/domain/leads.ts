/**
 * The leads book. Ports `ref/03-app.js` lines 453-495, verbatim — every name, number, city,
 * timestamp, unit count and comment as the prototype wrote them.
 *
 * 18 rows, 33 units, 3 closed as lost.
 */

import type { Lead } from "./types";

/* done = steps completed; at = when each was ticked */
export const LEADS: Lead[] = [
 {id:"L1",n:"Anand Pillai",     ph:"+91 99001 44821",em:"anand.pillai@gmail.com",city:"Bengaluru",own:"kavya",sec:"rohit", src:"Events",ev:"E-04",
  done:1,at:["23 Aug 18:04"], touch:{msg:[], email:[], call:[], visit:[]},units:1,nx:null,fc:null,late:2,consent:false},
 {id:"L2",n:"Sanjay Menon",     ph:"+91 98860 30012",em:"sanjay.menon@outlook.com",city:"Bengaluru",own:"rohit",sec:"kavya", src:"Events",ev:"E-03",
  done:2,at:["21 Aug 17:10","21 Aug 18:02"], touch:{msg:["21 Aug 18:02","24 Aug 09:40"], email:[], call:[], visit:[]},reply:null,units:1,nx:null,fc:null,late:5,consent:true},
 {id:"L3",n:"Girish Rao",       ph:"+91 93105 99705",em:"girish.rao@company.in",city:"Bengaluru",own:"kavya",sec:"rohit", src:"Events",ev:"E-04",
  done:4,at:["18 Aug 18:04","18 Aug 18:42","20 Aug 11:20","23 Aug 12:00"], touch:{msg:["18 Aug 18:42","23 Aug 10:05"], email:["19 Aug 09:15","22 Aug 09:30","26 Aug 08:50"], call:["20 Aug 11:02","25 Aug 16:10"], visit:[]},reply:"24 Aug 09:10",units:1,nx:{t:"Book a farm visit", by:"29 Aug", d:"2026-08-29", tm:"11:00", who:"kavya", at:"26 Aug 11:22"},fc:{c:"probable", by:"25 Sep", ev:"Wants the block walked before he commits", at:"26 Aug 11:25", who:"kavya"},late:0,consent:true},
 {id:"L4",n:"Meera Krishnan",   ph:"+91 98450 12277",em:"meera.k@gmail.com",city:"Bengaluru",own:"rohit",sec:"kavya", src:"Events",ev:"E-04",
  done:2,at:["23 Aug 18:06","23 Aug 20:12"], touch:{msg:["23 Aug 20:12"], email:["24 Aug 09:15"], call:["26 Aug 10:40"], visit:[]},reply:"26 Aug 10:52",units:2,nx:{t:"Call back", by:"28 Aug", d:"2026-08-28", tm:"16:30", who:"rohit", at:"27 Aug 09:40"},fc:{c:"pipeline", by:"", ev:"", at:"", who:"rohit"},late:0,consent:true},
 {id:"L5",n:"Deepa Varghese",   ph:"+91 90084 77310",em:"deepa.v@nrimail.com",city:"Kochi",    own:"kavya",sec:"rohit", src:"Founder network",ev:null,
  done:5,at:["12 Aug 09:00","12 Aug 09:14","14 Aug 11:00","16 Aug 12:00","18 Aug 16:20"], touch:{msg:["12 Aug 09:14"], email:["13 Aug 09:15"], call:["13 Aug 15:30"], visit:[]},units:4,nx:{t:"Send the reservation note", by:"28 Aug", d:"2026-08-28", tm:"16:30", who:"kavya", at:"25 Aug 10:10"},fc:{c:"commit", by:"12 Sep", ev:"Said yes on 18 Aug; advance promised this week", at:"25 Aug 10:12", who:"kavya"},late:0,consent:true},
 {id:"L6",n:"Prakash Bhat",     ph:"+91 97400 55519",em:"prakash.bhat@gmail.com",city:"Mysuru",   own:"rohit",sec:"kavya", src:"Referral — investor",ev:null,
  done:6,at:["02 Aug 10:00","02 Aug 10:22","05 Aug 09:30","09 Aug 12:00","12 Aug 17:00","24 Aug 11:06"], touch:{msg:["02 Aug 10:22"], email:["03 Aug 09:15"], call:["04 Aug 12:00"], visit:[]},units:1,nx:{t:"Chase the balance before the hold lapses", by:"29 Aug", who:"rohit", at:"24 Aug 11:10"},fc:{c:"commit", by:"02 Sep", ev:"Advance in on 24 Aug; balance promised before the hold ends", at:"24 Aug 11:12", who:"rohit"},late:0,consent:true},
 {id:"L7",n:"Joseph Mathew",    ph:"+91 95350 90067",em:"joseph.m@gulfmail.ae",city:"Dubai",    own:"kavya",sec:"tasneem",src:"Founder network",ev:null,
  done:6,at:["05 Aug 08:00","05 Aug 08:06","07 Aug 10:00","09 Aug 12:00","19 Aug 18:40","22 Aug 11:15"], touch:{msg:["05 Aug 08:06"], email:["06 Aug 09:15"], call:["06 Aug 14:00"], visit:[]},units:4,nx:{t:"FEMA declaration — chase the signed copy", by:"29 Aug", who:"kavya", at:"26 Aug 16:25"},fc:{c:"commit", by:"18 Sep", ev:"Advance in on 22 Aug; FEMA pack outstanding", at:"26 Aug 16:28", who:"kavya"},late:0,consent:true,nri:true},
 {id:"L8",n:"Rahul Sethi",      ph:"+91 99720 61140",em:"rahul.sethi@corp.in",city:"Bengaluru",own:"ananya",sec:"nikhil",src:"Events",ev:"E-03",
  done:4,at:["16 Aug 17:20","16 Aug 18:01","20 Aug 09:00","23 Aug 12:00"], touch:{msg:["16 Aug 18:01","21 Aug 09:00"], email:["17 Aug 09:15","20 Aug 09:10","24 Aug 09:05","27 Aug 08:55"], call:["19 Aug 11:00","26 Aug 15:30"], visit:[]},reply:null,units:2,nx:null,fc:{c:"probable", by:"30 Sep", ev:"Attended E-03; two units discussed", at:"23 Aug 12:05", who:"ananya"},late:3,consent:true},
 {id:"L9",n:"Lakshmi Iyer",     ph:"+91 96320 88104",em:"lakshmi.iyer@gmail.com",city:"Chennai",  own:"ananya",sec:"nikhil",src:"Website",ev:null,
  done:2,at:["18 Aug 10:00","18 Aug 10:09"], touch:{msg:["18 Aug 10:09","22 Aug 09:20"], email:["19 Aug 09:15","23 Aug 09:00"], call:["20 Aug 15:00"], visit:[]},reply:null,units:1,nx:{t:"Call back", by:"29 Aug", d:"2026-08-29", tm:"09:30", who:"ananya", at:"26 Aug 09:00"},fc:{c:"pipeline", by:"", ev:"", at:"", who:"ananya"},late:0,consent:true},
 {id:"L10",n:"Vikram Shetty",   ph:"+91 94480 20093",em:"vikram.shetty@gmail.com",city:"Mangaluru",own:"nikhil",sec:"ananya",src:"Channel partner",ev:null,
  done:2,at:["19 Aug 12:00","19 Aug 13:13"], touch:{msg:["19 Aug 13:13"], email:["20 Aug 09:15"], call:["22 Aug 10:00"], visit:[]},units:1,nx:{t:"Call back", by:"29 Aug", d:"2026-08-29", tm:"11:00", who:"nikhil", at:"26 Aug 14:30"},fc:{c:"pipeline", by:"", ev:"", at:"", who:"nikhil"},late:0,consent:true},
 {id:"L11",n:"Nandini Reddy",   ph:"+91 90190 74428",em:"nandini.r@company.co.in",city:"Hyderabad",own:"nikhil",sec:"ananya",src:"LinkedIn",ev:null,
  done:3,at:["20 Aug 09:00","20 Aug 09:19","23 Aug 10:00"], touch:{msg:["20 Aug 09:19"], email:["21 Aug 09:15","25 Aug 09:10"], call:["22 Aug 16:00"], visit:[]},reply:"22 Aug 16:22",units:1,nx:{t:"Send the deck and the yield note", by:"29 Aug", who:"nikhil", at:"23 Aug 10:05"},fc:{c:"probable", by:"10 Oct", ev:"Qualified 23 Aug; asked for the yield note", at:"23 Aug 10:08", who:"nikhil"},late:0,consent:true},
 /* three that ended. Without them the funnel never settles and "why we lose" has nothing to read. */
 {id:"L14",n:"Suresh Menon",     ph:"+91 98450 66123",em:"suresh.menon@gmail.com",city:"Bengaluru",own:"kavya",sec:"rohit", src:"Events",ev:"E-02",
  done:3,at:["14 Jul 10:00","14 Jul 10:40","18 Jul 15:00"], touch:{msg:["14 Jul 10:40"], email:["15 Jul 09:15"], call:["17 Jul 11:00"], visit:[]},reply:"17 Jul 11:20",units:1,nx:null,fc:null,consent:true,
  lost:{why:"Lock-in too long", note:"Wanted an exit inside three years.", at:"29 Jul 16:20", by:"kavya", stage:3}},
 {id:"L15",n:"Preethi Nayak",    ph:"+91 99011 20876",em:"preethi.n@corp.in",   city:"Mysuru",   own:"rohit",sec:"kavya", src:"Website",ev:null,
  done:2,at:["21 Jul 09:00","21 Jul 12:30"], touch:{msg:["21 Jul 12:30","25 Jul 09:00","31 Jul 09:10"], email:["22 Jul 09:15","28 Jul 09:00"], call:["24 Jul 16:00"], visit:[]},reply:null,units:2,nx:null,fc:null,consent:true,
  lost:{why:"Went cold — no reply", note:"Six attempts, nothing back after the first call.", at:"06 Aug 10:05", by:"rohit", stage:2}},
 {id:"L16",n:"Aditya Ranganath", ph:"+91 97310 45590",em:"aditya.r@gmail.com",  city:"Chennai",  own:"ananya",sec:"nikhil",src:"Referral — investor",ev:null,
  done:4,at:["02 Aug 11:00","02 Aug 11:30","06 Aug 10:00","11 Aug 16:00"], touch:{msg:["02 Aug 11:30"], email:["03 Aug 09:15"], call:["05 Aug 14:00","12 Aug 10:00"], visit:[]},reply:"12 Aug 10:25",units:3,nx:null,fc:null,consent:true,
  lost:{why:"Price too high", note:"Compared it against a plot in Hoskote at half the ticket.", at:"19 Aug 12:40", by:"ananya", stage:4}},
 {id:"L12",n:"Farida Contractor",ph:"+91 98201 33471",em:"farida.c@gmail.com",city:"Mumbai",  own:"ananya",sec:"nikhil",src:"Events",ev:"E-03",
  done:1,at:["16 Aug 17:40"], touch:{msg:[], email:[], call:[], visit:[]},units:1,nx:null,fc:null,late:4,consent:true},
 {id:"U1",n:"Ritu Anand",       ph:"+91 98450 77219",em:"ritu.anand@gmail.com",city:"Bengaluru",own:null,sec:null, src:"Founder network",ev:null,
  done:1,at:["27 Aug 09:15"], touch:{msg:[], email:[], call:[], visit:[]},units:4,nx:null,fc:null,late:1,consent:true,by:"tasneem"},
 {id:"U2",n:"Harish Kamath",     ph:"+91 99012 33847",em:"h.kamath@corp.in",   city:"Mysuru",   own:null, src:"Channel partner",ev:null,
  done:1,at:["27 Aug 11:40"], touch:{msg:[], email:[], call:[], visit:[]},units:2,nx:null,fc:null,late:0,consent:true,by:"jhalak"},
 {id:"L13",n:"R. Sundaram",     ph:"+91 99458 11207",em:"r.sundaram@gmail.com",city:"Bengaluru",own:"kavya",sec:"rohit", src:"Events",ev:"E-02",
  done:7,at:["09 Jul 11:00","09 Jul 11:20","12 Jul 09:00","12 Jul 12:00","18 Jul 16:00","22 Jul 10:00","20 Aug 14:30"], touch:{msg:["09 Jul 11:20"], email:["10 Jul 09:15"], call:["11 Jul 10:00"], visit:[]},units:1,nx:{t:"Onboarding call — app access", by:"29 Aug", who:"kavya", at:"20 Aug 14:35"},fc:{c:"commit", by:"20 Aug", ev:"Paid in full on 20 Aug; allocation and onboarding next", at:"20 Aug 14:32", who:"kavya"},late:0,consent:true}
];
