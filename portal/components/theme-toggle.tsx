"use client"

import { useTheme } from "next-themes"
import { useEffect, useState } from "react"

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  // The server cannot know the resolved theme, so render a stable placeholder until
  // mount rather than emitting markup that will mismatch on hydration.
  useEffect(() => setMounted(true), [])

  // Gate on `mounted` too: the label must match server markup until hydration is done.
  const dark = mounted && resolvedTheme === "dark"
  return (
    <button
      type="button"
      onClick={() => setTheme(dark ? "light" : "dark")}
      aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
      className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      {mounted ? (dark ? "☀" : "☾") : <span className="opacity-0">☾</span>}
    </button>
  )
}
