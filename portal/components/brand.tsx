"use client"

import { createContext, useContext } from "react"

/**
 * The portal's name (`PORTAL_NAME`), read on the server per request by the root layout.
 * A context rather than NEXT_PUBLIC_: one built image serves any company's name.
 */
const Brand = createContext("Agent Portal")

export function BrandProvider({ name, children }: { name: string; children: React.ReactNode }) {
  return <Brand.Provider value={name}>{children}</Brand.Provider>
}

export function useBrand(): string {
  return useContext(Brand)
}
