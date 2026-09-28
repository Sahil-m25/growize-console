"use client";

/* /inv — Investors, an Investors-side page (merge-glue.js MERGE). `?id=` opens one investor when the
   seat reads it, and is refused in-page when it does not (InvLink, M09-S08). */

import { ImOnly } from "@/features/im/host";
import { InvLink } from "@/features/im/paper2/InvLink";

export default function Page() {
  return <><InvLink /><ImOnly k="inv" /></>;
}
