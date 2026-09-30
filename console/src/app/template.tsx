/* M01-S01-W1 — THE PAGE GUARD (M01-S01-T04/T06). A server component around every page: the signed-in
   person's seat decides whether this page is theirs, on the server, before anything is drawn. A page
   outside the seat goes to the seat's landing page; a signed-out person goes to "/" (the sign-in screen).
   Not in middleware: that runs on Edge and cannot read the session store (server/access/guard).
   Fixture mode and the phase-1 stub pass through (the demo's own Shell gate decides there). "/" and
   anything that is not a console page carry no page id and are never refused here (no redirect loop). */

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { pageGuard, pageIdOf } from "@/server/access/guard";

export default async function Template({ children }: { children: React.ReactNode }) {
  const page = pageIdOf((await headers()).get("x-gz-path"));
  if (page !== null) {
    const v = await pageGuard(page);
    if (!v.ok && v.landing !== "/" + page) redirect(v.landing);
  }
  return <>{children}</>;
}
