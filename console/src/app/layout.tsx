/* The one mount point. ConsoleProvider wraps everything and the Shell is what every route renders
   into — the rail, the top bar, the pane and the drawer, exactly as 02-body.html has them.

   Fonts: Inter is embedded in console.css (a data: URL) and the mono stack falls back to the system
   monospace. No <link> to a font host (TC-IM01-001, M01-S01-T08): the console loads offline. */

import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { ConsoleProvider } from "@/lib/store";
import { loadPayload } from "@/lib/data/source";
import { currentLane, fixtureModeOn, resetFixtures } from "@/lib/fixture-mode";
import { Door } from "@/components/shell/SignIn";
import "./console.css";
import { ReticleDev } from "./reticle-dev";

export const metadata: Metadata = {
  title: "Growize IR Console — Investor workspace",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  /* FIXTURE_MODE=local: a fresh load of "/" (a document request, not a client-side navigation)
     starts a test case, so the applied fixtures are cleared first — exactly as a fresh prototype page
     starts from its own demo book. */
  if (fixtureModeOn()) {
    const h = await headers();
    if (h.get("x-gz-path") === "/" && h.get("rsc") !== "1" && h.get("next-router-prefetch") == null) resetFixtures(await currentLane());
  }
  /* the records are in the first paint: the same payload GET /api/data serves */
  /* a book Zoho refused (LiveReadError, e.g. a seat whose profile cannot read a module) must not take the whole page
     down: the first paint goes out without records and the client's own GET /api/data shows the 503 and its `fresh`
     block, as it does for any later failed read. Anything else still throws. */
  const initial = await loadPayload().catch((e: unknown) => {
    if (e instanceof Error && e.name === "LiveReadError") return undefined;
    throw e;
  });
  return (
    /* the redesigned markup's own attributes, line 2: en-IN, and light unless Dark was saved —
       see useThemeSync, which never removes this attribute, only overwrites it */
    <html lang="en-IN" data-theme="light">
      {/* ux-refined / ux-redesign — the redesigned prototype's own <body class>, ~2356. Most of
          console.css's redesigned rules are scoped under one or both of these; without the class
          here they are simply inert. */}
      <body className="ux-refined ux-redesign">
        {/* Reticle: dev-only runtime checks for the agent (tools/PLUGINS.md) */}
        {process.env.NODE_ENV === "development" ? <ReticleDev /> : null}
        <ConsoleProvider initial={initial}>
          <Door>{children}</Door>
        </ConsoleProvider>
      </body>
    </html>
  );
}
