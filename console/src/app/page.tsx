/* "/" — where a person starts (Home). In FIXTURE_MODE=local, a fresh load of "/" (a document request,
   not a client-side navigation) is also where a test case starts: the applied fixtures are cleared so
   every case begins from the plain demo book, exactly as a fresh prototype page does. */

import { headers } from "next/headers";
import { fixtureModeOn, resetFixtures } from "@/lib/fixture-mode";
import { Home } from "./Home";

export const dynamic = "force-dynamic";

export default async function Page() {
  if (fixtureModeOn()) {
    const h = await headers();
    if (h.get("rsc") !== "1" && h.get("next-router-prefetch") == null) resetFixtures();
  }
  return <Home />;
}
