"use client";

/* appearanceControls(place) — ir-console-redesigned.html 13398. Two explicit choices rather than a
   single toggle, so the current choice is always visible rather than inferred from a symbol. The
   attribute itself is written by the shell's ThemeButton effect (components/shell/ThemeButton.tsx);
   this only dispatches the same `setTheme` action and reflects `state.ui.THEME` back. */

import { useConsole } from "@/lib/store";
import type { Theme } from "@/lib/store";

const CHOICES: readonly Theme[] = ["light", "dark"];

export function AppearanceControls({ place }: { place: string }) {
  const { state, dispatch } = useConsole();
  const isDark = state.ui.THEME === "dark";
  return (
    <div className="rd-appearance" role="group" aria-label="Colour theme">
      <div className="rd-appearance-options">
        {CHOICES.map((theme) => {
          const on = isDark === (theme === "dark");
          return (
            <button
              type="button"
              key={theme}
              className={`rd-theme-choice ${on ? "on" : ""}`}
              id={`appearance-${place}-${theme}`}
              aria-pressed={on ? "true" : "false"}
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
