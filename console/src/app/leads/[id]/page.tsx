"use client";

/* /leads/[id] — one lead. The prototype's `go('lead', id)`; here the id is in the path and the
   store mirrors it into LEAD from the Shell. */

import { useParams } from "next/navigation";
import { LeadPage } from "@/features/lead/LeadPage";

export default function Page() {
  const p = useParams<{ id: string }>();
  const id = Array.isArray(p?.id) ? p.id[0] : (p?.id ?? "");
  return <LeadPage id={decodeURIComponent(id)} />;
}
