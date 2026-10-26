"use client"

import { createContext, useCallback, useContext, useEffect, useState } from "react"

import { getMe } from "@/lib/api"
import type { Me } from "@/lib/types"
import { ActivityDrawer } from "./activity-drawer"
import { AppBar } from "./app-bar"

const MeContext = createContext<{ me: Me | null; bump: () => void }>({ me: null, bump: () => {} })

/** Who is signed in, as resolved server-side. Roles drive which experiences show. */
export function useMe() {
  return useContext(MeContext)
}

/**
 * The frame every page shares: app bar (Use · Build · Publish, by role), the page, and
 * the Fleet-activity drawer that shows the calls made on the user's behalf.
 */
/**
 * `wide` = full-bleed, viewport-high layout (the chat page). Otherwise the page scrolls
 * and content is centred at `max` (Build's editor needs room for the test chat).
 */
export function Shell({
  children,
  crumb,
  wide,
  max = "max-w-6xl",
}: {
  children: React.ReactNode
  crumb?: React.ReactNode
  wide?: boolean
  max?: "max-w-6xl" | "max-w-7xl"
}) {
  const [me, setMe] = useState<Me | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const bump = useCallback(() => setTick((t) => t + 1), [])

  useEffect(() => {
    getMe()
      .then(setMe)
      .catch((e) => setError(e instanceof Error ? e.message : "Could not reach the portal backend"))
  }, [])

  return (
    <MeContext.Provider value={{ me, bump }}>
      <div className={`flex flex-col bg-canvas ${wide ? "min-h-dvh lg:h-dvh lg:overflow-hidden" : "min-h-dvh"}`}>
        <AppBar me={me} crumb={crumb} />
        {me?.dev && (
          <div className="border-b border-border/60 bg-secondary/60 px-4 py-1.5 text-center text-[11px] text-muted-foreground">
            Dev sign-in: every persona reaches LangSmith as the same API key — per-user governance is not visible in this mode.
          </div>
        )}
        <main id="main" className={`flex min-h-0 flex-1 flex-col ${wide ? "" : `mx-auto w-full ${max} px-4 py-8 sm:px-6`}`}>
          {error ? (
            <p className="m-6 rounded-xl border border-destructive/30 bg-destructive/5 px-3.5 py-2.5 text-[13px] text-destructive">{error}</p>
          ) : (
            children
          )}
        </main>
        <ActivityDrawer refreshKey={tick} />
      </div>
    </MeContext.Provider>
  )
}
