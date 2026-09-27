"use client";

/* /pay — one rail entry for a page both sides have (merge-glue.js MERGE): the lead half, the
   Investors half, or a switch between them, decided by which halves the person holds. */

import { PayPage } from "@/features/pay/PayPage";
import { Sided } from "@/features/im/host";

export default function Page() {
  return <Sided k="pay" lead={<PayPage />} />;
}
