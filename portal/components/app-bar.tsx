"use client"

import clsx from "clsx"
import Link from "next/link"
import { usePathname } from "next/navigation"

import { logout } from "@/app/actions"
import { switchWorkspace } from "@/lib/api"
import type { Me } from "@/lib/types"
import { useBrand } from "./brand"
import { ThemeToggle } from "./theme-toggle"
import { Icon } from "./ui"

function Initials({ name, email }: { name?: string; email?: string }) {
  const src = name || email || "?"
  const words = src.includes("@") ? [src] : src.replace(/[^\p{L}\s]/gu, " ").split(/\s+/).filter(Boolean)
  const initials = (words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? "?").slice(0, 2)).toUpperCase()
  return (
    <span title={email || name} className="grid h-8 w-8 place-items-center rounded-full bg-brand text-[11px] font-semibold text-brand-foreground ring-2 ring-background">
      {initials || "?"}
    </span>
  )
}

const NAV = [
  { href: "/", label: "Use", match: (p: string) => p === "/" || p.startsWith("/agents") },
  { href: "/studio", label: "Build", match: (p: string) => p.startsWith("/studio"), builder: true },
  { href: "/publish", label: "Publish", match: (p: string) => p.startsWith("/publish"), builder: true },
]

export function AppBar({ me, crumb }: { me: Me | null; crumb?: React.ReactNode }) {
  const path = usePathname()
  const brand = useBrand()
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-4 border-b border-border/60 bg-background/80 px-4 backdrop-blur-md sm:px-6">
      <div className="flex min-w-0 items-center gap-4">
        <Link href="/" className="flex items-center gap-2.5 font-semibold tracking-tight">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-brand shadow-card">
            <svg viewBox="0 0 12 12" fill="none" className="h-3.5 w-3.5" aria-hidden>
              <path d="M2 6h8M6 2v8" stroke="currentColor" className="text-brand-foreground" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </span>
          {brand}
        </Link>
        <nav className="flex items-center gap-0.5 rounded-full bg-secondary/70 p-1 dark:bg-card" aria-label="Experiences">
          {NAV.filter((n) => !n.builder || me?.can_build).map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={clsx(
                "rounded-full px-3.5 py-1 text-[13px] transition-colors",
                n.match(path) ? "bg-background font-medium text-foreground shadow-card dark:bg-accent" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {n.label}
            </Link>
          ))}
        </nav>
        {crumb && <span className="hidden min-w-0 truncate text-[13px] text-muted-foreground md:inline">{crumb}</span>}
      </div>

      <div className="flex items-center gap-2">
        {me && me.workspaces.length > 1 ? (
          <select
            aria-label="Workspace"
            value={me.current_workspace?.id ?? ""}
            onChange={async (e) => {
              await switchWorkspace(e.target.value)
              window.location.href = "/"
            }}
            className="hidden h-8 rounded-full border border-border/80 bg-card px-3 text-xs text-muted-foreground sm:block"
          >
            {me.workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        ) : me?.current_workspace ? (
          <span className="hidden h-8 items-center gap-1.5 rounded-full border border-border/80 bg-card px-3 text-xs text-muted-foreground sm:inline-flex">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: "oklch(0.62 0.15 155)" }} aria-hidden />
            {me.current_workspace.name}
          </span>
        ) : null}
        {me?.is_admin && me.langsmith_ui && (
          <a
            href={me.langsmith_ui}
            target="_blank"
            rel="noreferrer"
            title="Governance is configured in LangSmith: roles, access policies, model access, spend limits"
            className="hidden h-8 items-center gap-1 rounded-full px-3 text-xs text-muted-foreground hover:bg-accent hover:text-foreground md:inline-flex"
          >
            Admin in LangSmith <Icon name="external" className="h-3 w-3" />
          </a>
        )}
        <ThemeToggle />
        {me && (
          <details className="relative">
            <summary className="list-none cursor-pointer" aria-label="Account">
              <Initials name={me.name} email={me.email} />
            </summary>
            <div className="absolute right-0 z-40 mt-2 w-64 rounded-2xl bg-popover p-4 text-[12px] shadow-pop ring-1 ring-border/60">
              <p className="font-medium">{me.name || me.email}</p>
              {me.name && <p className="text-muted-foreground">{me.email}</p>}
              <p className="mt-2 text-[11px] text-muted-foreground">Roles</p>
              <p className="mb-3">{me.roles.length ? me.roles.join(", ") : "—"}</p>
              <form action={logout}>
                <button className="w-full rounded-lg px-2.5 py-1.5 text-left font-medium hover:bg-accent">Sign out</button>
              </form>
            </div>
          </details>
        )}
      </div>
    </header>
  )
}
