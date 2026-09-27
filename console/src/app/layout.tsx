/* The one mount point. ConsoleProvider wraps everything and the Shell is what every route renders
   into — the rail, the top bar, the pane and the drawer, exactly as 02-body.html has them.

   The two fonts are loaded the way the prototype loads them, with a <link>, so the console reads
   the same here as it does there and nothing is fetched at build time. */

import type { Metadata, Viewport } from "next";
import { ConsoleProvider } from "@/lib/store";
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

export default function RootLayout({ children }: { children: React.ReactNode }) {
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
        <ConsoleProvider>
          <Door>{children}</Door>
        </ConsoleProvider>
      </body>
    </html>
  );
}
