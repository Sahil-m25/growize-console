"use client";

/* THEME PERSISTENCE — the redesigned prototype dropped the top bar's lone ◐ toggle for the named
   Light/Dark pair in the account menu (see @/components/ui/Appearance) and, alongside it, started
   saving the choice: setTheme() writes localStorage in a try/catch (03-app.js:13389-13394) and the
   very end of the script reads it back the same way, before the first draw() (03-app.js:13578).

   Nothing here renders. useThemeSync() is a hook, not a component, because there is no longer a
   button that owns this — only the <html data-theme> attribute and the saved preference, kept in
   sync with `state.ui.THEME` from wherever the shell mounts it once (Shell.tsx). Reading and
   writing are both wrapped: a private window, cleared site data or a sandboxed preview can throw
   or come back empty, and the console still has to render. */

import { useEffect } from "react";
import { useConsole } from "@/lib/store";
import { APPEARANCE_KEY } from "@/components/ui";

export function useThemeSync(): void {
  const { state, dispatch } = useConsole();
  const theme = state.ui.THEME;

  useEffect(() => {
    if (theme === null) {
      let saved: string | null = null;
      try {
        saved = localStorage.getItem(APPEARANCE_KEY);
      } catch {
        /* no storage — follow prefers-color-scheme, exactly as if nothing had ever been saved */
      }
      if (saved === "light" || saved === "dark") {
        dispatch({ type: "setTheme", theme: saved });
      }
      /* nothing saved: leave the markup's own `data-theme="light"` alone. The prototype's own
         init (03-app.js:13578) only ever overwrites the attribute for a saved "light"/"dark" — it
         never removes it — so an unsaved visit is light regardless of prefers-color-scheme. */
      return;
    }
    document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem(APPEARANCE_KEY, theme);
    } catch {
      /* the choice still applies to this tab; it just will not greet the next one */
    }
  }, [theme, dispatch]);
}
