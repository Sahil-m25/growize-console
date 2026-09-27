/* The one mount point. ConsoleProvider wraps everything and the Shell is what every route renders
   into — the rail, the top bar, the pane and the drawer, exactly as 02-body.html has them.

   The two fonts are loaded the way the prototype loads them, with a <link>, so the console reads
   the same here as it does there and nothing is fetched at build time. */

import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { ConsoleProvider } from "@/lib/store";
import { loadPayload } from "@/lib/data/source";
import { fixtureModeOn, resetFixtures } from "@/lib/fixture-mode";
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
    if (h.get("x-gz-path") === "/" && h.get("rsc") !== "1" && h.get("next-router-prefetch") == null) resetFixtures();
  }
  /* the records are in the first paint: the same payload GET /api/data serves */
  const initial = await loadPayload();
  return (
    /* the redesigned markup's own attributes, line 2: en-IN, and light unless Dark was saved —
       see useThemeSync, which never removes this attribute, only overwrites it */
    <html lang="en-IN" data-theme="light">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&display=swap"
        />
      </head>
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
