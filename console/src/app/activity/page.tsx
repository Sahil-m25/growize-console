"use client";

/* /activity — one rail entry for a page both sides have (merge-glue.js MERGE): the lead half, the
   Investors half, or a switch between them, decided by which halves the person holds. */

import { ActivityPage } from "@/features/activity";
import { Sided } from "@/features/im/host";

export default function Page() {
  return <Sided k="activity" lead={<ActivityPage />} />;
}
