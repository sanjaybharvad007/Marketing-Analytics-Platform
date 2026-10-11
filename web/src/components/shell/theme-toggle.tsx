"use client";

import { Moon, Sun } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export type Theme = "light" | "dark";

/** Runs before first paint when no theme cookie exists, to follow the OS setting. */
export const THEME_INIT_SCRIPT = `(function(){var d=document.documentElement;if(!d.dataset.theme){d.dataset.theme=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}})()`;

export function ThemeToggle({ initial }: { initial: Theme | null }) {
  const [theme, setTheme] = useState<Theme | null>(initial);

  function toggle() {
    const current = (document.documentElement.dataset.theme as Theme | undefined) ?? "light";
    const next: Theme = current === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    document.cookie = `theme=${next}; path=/; max-age=31536000; samesite=lax`;
    setTheme(next);
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggle}
      aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
      title="Switch theme"
    >
      {/* Both icons render; CSS shows the one for the active theme, so there is no flash. */}
      <Sun aria-hidden="true" className="hidden size-4 dark:block" />
      <Moon aria-hidden="true" className="size-4 dark:hidden" />
    </Button>
  );
}
