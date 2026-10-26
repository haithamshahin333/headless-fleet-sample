"use client"

import { useCallback, useState } from "react"

import { bindAgent, pollConnect, startConnect } from "./api"
import type { Integration } from "./types"

/**
 * The OAuth connect flow — the on-behalf-of step. Fleet has no token-exchange grant,
 * so connecting a provider is always an authorization-code consent in a popup. When the
 * person is already signed in to that provider (and an admin consented for the provider's
 * app) it completes with no prompt.
 *
 * `strategy: "REUSE"` often finishes server-side by refreshing an existing token, so
 * there is frequently nothing to show — the hook handles "already done".
 *
 * `bindAgentId` is passed ONLY for shared-identity agents ("use this agent's
 * connections"), whose runs use a connection bound to the agent. Personal agents resolve
 * each caller's own token at run time and need no binding.
 */
export type ConnectState = "idle" | "connecting" | "waiting" | "connected" | "failed" | "expired"

/** The OAuth provider an integration authenticates against, plus its scopes. */
export function providerFor(i?: Integration): { slug: string | null; scopes: string[] } {
  for (const m of i?.auth_methods ?? []) {
    if (m?.provider_match?.value && (m.provider_match.by === "slug" || !m.provider_match.by)) {
      return { slug: m.provider_match.value, scopes: m.scopes ?? [] }
    }
  }
  return { slug: null, scopes: [] }
}

export function useConnect(bindAgentId?: string, onConnected?: () => void) {
  const [state, setState] = useState<ConnectState>("idle")
  const [activeSlug, setActiveSlug] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [consentUrl, setConsentUrl] = useState<string | null>(null)

  const reset = useCallback(() => {
    setState("idle")
    setActiveSlug(null)
    setNote(null)
    setConsentUrl(null)
  }, [])

  const finish = useCallback(
    async (slug: string) => {
      if (bindAgentId) {
        const { bound } = await bindAgent(bindAgentId, slug).catch(() => ({ bound: false }))
        setNote(bound ? "Connected and bound to this agent." : "Connected, but binding to the agent failed.")
      } else {
        setNote("Connected.")
      }
      setState("connected")
      setConsentUrl(null)
      onConnected?.()
    },
    [bindAgentId, onConnected],
  )

  const connect = useCallback(
    async (slug: string, scopes: string[] = []) => {
      setActiveSlug(slug)
      setState("connecting")
      setNote(null)
      setConsentUrl(null)
      // Open the window inside the click so popup blockers allow it; point it at the
      // consent URL once we have one, or close it if REUSE finished silently.
      const popup = typeof window !== "undefined" ? window.open("about:blank", "fleet-connect", "popup,width=520,height=720") : null
      try {
        const started = await startConnect(slug, scopes)
        if (started.state === "connected") {
          popup?.close()
          await finish(slug)
          return
        }
        if (started.verification_url) {
          setConsentUrl(started.verification_url)
          if (popup && !popup.closed) {
            popup.opener = null
            popup.location.href = started.verification_url
          }
        } else popup?.close()
        if (!started.session_id) {
          setState("failed")
          setNote("Authorization started but returned no session to track.")
          return
        }
        setState("waiting")
        setNote("Waiting for you to finish authorizing in the popup…")
        const deadline = Date.now() + 5 * 60 * 1000
        while (Date.now() < deadline) {
          const res = await pollConnect(started.session_id)
          if (res.state === "connected") {
            await finish(slug)
            return
          }
          if (res.state === "failed" || res.state === "expired") {
            setState(res.state)
            setNote(res.state === "failed" ? "Authorization was rejected." : "Session expired.")
            return
          }
        }
        setState("expired")
        setNote("Gave up waiting after 5 minutes.")
      } catch (e) {
        popup?.close()
        setState("failed")
        setNote(e instanceof Error ? e.message : "connect failed")
      }
    },
    [finish],
  )

  return { state, activeSlug, note, consentUrl, connect, reset }
}
