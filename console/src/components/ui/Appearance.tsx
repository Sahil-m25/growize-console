"use client";

/* APPEARANCE — the redesigned prototype's appearanceControls()/setTheme()/themeIsDark(), ~13389.

   Two named choices, not a single toggle: the redesign's account menu and Profile page both offer
   the same "Light" / "Dark" pair rather than the old lone ◐ button, and both save the same way —
   in localStorage, in a try/catch, because this renders inside a preview that does not always keep
   it. Reading it back is the shell's job too; see the effect in Shell.tsx that owns the
   document-level <html data-theme> attribute this reads and writes. */

import { useConsole } from "@/lib/store";

/** growize-console-appearance — the prototype's own storage key, kept so a saved choice from one
 *  build reads back in the other. */
export const APPEARANCE_KEY = "growize-console-appearance";

export function AppearanceControls({ place }: { place: string }) {
  const { state, dispatch } = useConsole();
  /* themeIsDark() — 03-app.js:13396. With no choice made yet this reads as "Light" selected, the
     same false-but-harmless default the prototype shows before its own attribute is set. */
  const dark = state.ui.THEME === "dark";
  return (
    <div className="rd-appearance" role="group" aria-label="Colour theme">
      <div className="rd-appearance-options">
        {(["light", "dark"] as const).map((theme) => {
          const on = dark === (theme === "dark");
          return (
            <button
              key={theme}
              type="button"
              className={`rd-theme-choice${on ? " on" : ""}`}
              id={`appearance-${place}-${theme}`}
              aria-pressed={on}
              onClick={() => dispatch({ type: "setTheme", theme })}
            >
              <span className={`rd-theme-swatch rd-theme-${theme}`} aria-hidden="true" />
              <span>{theme === "light" ? "Light" : "Dark"}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
