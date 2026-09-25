"use client";

/* "/" is not a screen. It is the question "where does this person start?", and landSafe() is the
   prototype's answer to it — the first screen the seat holds, with My day preferred when the seat
   has one. 03-app.js:7145. */

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useConsole } from "@/lib/store";
import { landSafe } from "@/components/shell/nav";
import { pathOf } from "@/components/shell/routes";

export default function Home() {
  const { state } = useConsole();
  const router = useRouter();
  const land = landSafe(state, null);

  useEffect(() => {
    router.replace(pathOf(land));
  }, [land, router]);

  return null;
}
