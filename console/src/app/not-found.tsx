"use client";

/* The prototype has no 404: go() with an unknown key returns silently and leaves you where you
   are. A typed URL has no "where you are", so the nearest honest equivalent is the same answer "/"
   gives — the person's own landing page. Nothing is invented here and no new copy is shown. */

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useConsole } from "@/lib/store";
import { landSafe } from "@/components/shell/nav";
import { pathOf } from "@/components/shell/routes";

export default function NotFound() {
  const { state } = useConsole();
  const router = useRouter();
  const land = landSafe(state, null);

  useEffect(() => {
    router.replace(pathOf(land));
  }, [land, router]);

  return null;
}
