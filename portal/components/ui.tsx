/**
 * The handful of primitives this portal needs, written against the brand tokens in
 * globals.css. Deliberately not a component library: the tokens carry the look, and a
 * few small components beat a dependency tree.
 *
 * Surfaces are layers, not boxes: a card is a soft shadow plus a faint ring on the
 * page canvas, and rows inside it are separated by hairlines or hover colour only.
 */
import clsx from "clsx"

export function Chip({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={clsx(
        "inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-full border bg-background px-2.5 text-xs text-muted-foreground",
        className,
      )}
    >
      {children}
    </span>
  )
}

export function StatusPill({ state, label }: { state: "ready" | "idle" | "error"; label?: string }) {
  const dot =
    state === "ready" ? "bg-[var(--ok)]" : state === "error" ? "bg-destructive" : "bg-muted-foreground/50"
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <span
        className={clsx("h-1.5 w-1.5 rounded-full", dot)}
        style={state === "ready" ? { background: "oklch(0.62 0.15 155)" } : undefined}
      />
      {label ?? (state === "ready" ? "Ready" : state === "error" ? "Unreachable" : "Idle")}
    </span>
  )
}

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "primary" | "ghost" | "danger"
  size?: "sm" | "md" | "lg"
}

/** Shared by <Button> and by links styled as buttons, so the two never drift apart. */
export function buttonClass(variant: ButtonProps["variant"] = "default", size: ButtonProps["size"] = "md", className?: string) {
  return clsx(
    "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border font-medium outline-none transition-[background-color,color,box-shadow,filter] focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50",
    size === "sm" && "h-7 px-2.5 text-xs",
    size === "md" && "h-8 px-3.5 text-[13px]",
    size === "lg" && "h-10 px-4 text-[14px]",
    variant === "primary" && "border-transparent bg-brand text-brand-foreground shadow-card hover:brightness-110",
    variant === "default" && "border-border/80 bg-card text-foreground shadow-card hover:bg-accent",
    variant === "ghost" && "border-transparent bg-transparent text-muted-foreground hover:bg-accent hover:text-foreground",
    variant === "danger" && "border-border/80 bg-card text-muted-foreground hover:border-destructive/50 hover:text-destructive",
    className,
  )
}

export function Button({ variant = "default", size = "md", className, ...rest }: ButtonProps) {
  return <button {...rest} className={buttonClass(variant, size, className)} />
}

/** The one surface style: soft shadow, faint ring, generous radius. */
export const surfaceClass = "rounded-2xl bg-card shadow-card ring-1 ring-border/60"

export function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={clsx(surfaceClass, "p-5", className)}>{children}</div>
}

/** A titled card: the building block of Build's composer and editor. */
export function SectionCard({
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title?: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
  children: React.ReactNode
  className?: string
  bodyClassName?: string
}) {
  return (
    <section className={clsx(surfaceClass, className)}>
      {(title || actions) && (
        <header className="flex items-start justify-between gap-3 px-5 pt-5">
          <div className="min-w-0">
            {title && <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>}
            {description && <p className="mt-0.5 text-[12.5px] text-muted-foreground">{description}</p>}
          </div>
          {actions}
        </header>
      )}
      <div className={bodyClassName ?? clsx("p-5", title && "pt-4")}>{children}</div>
    </section>
  )
}

export function Tag({ children, className, title }: { children: React.ReactNode; className?: string; title?: string }) {
  return (
    <span
      title={title}
      className={clsx(
        "inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-full bg-secondary px-2 text-[11px] font-medium text-muted-foreground dark:bg-accent",
        className,
      )}
    >
      {children}
    </span>
  )
}

export function Mono({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={clsx("font-mono text-[0.8125rem]", className)}>{children}</span>
}

/* ── Line icons: static paths on a 24px grid, stroked in currentColor ─────────── */

const ICONS = {
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-3.5 3.6-5.5 8-5.5s8 2 8 5.5" />
    </>
  ),
  swap: <path d="M7 7h11l-3-3M17 17H6l3 3" />,
  monitor: (
    <>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </>
  ),
  plug: <path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0zM12 17v4" />,
  plus: <path d="M12 5v14M5 12h14" />,
  lock: (
    <>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </>
  ),
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  chevron: <path d="M9 6l6 6-6 6" />,
  sparkle: <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />,
  bot: (
    <>
      <rect x="4" y="8" width="16" height="12" rx="3" />
      <path d="M12 4v4M9 13.5v1M15 13.5v1" />
    </>
  ),
  chip: (
    <>
      <rect x="6" y="6" width="12" height="12" rx="2" />
      <path d="M9 2.5v3.5M15 2.5v3.5M9 18v3.5M15 18v3.5M2.5 9H6M2.5 15H6M18 9h3.5M18 15h3.5" />
    </>
  ),
  chat: <path d="M20 12a8 8 0 0 1-11.6 7.1L4 20l.9-4.4A8 8 0 1 1 20 12z" />,
  external: <path d="M7 17L17 7M9 7h8v8" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M20 20l-4.2-4.2" />
    </>
  ),
  x: <path d="M6 6l12 12M18 6L6 18" />,
} satisfies Record<string, React.ReactNode>

export type IconName = keyof typeof ICONS

export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={clsx("h-3.5 w-3.5 flex-none", className)}
    >
      {ICONS[name]}
    </svg>
  )
}

/* ── Agent avatar: the first letter of the name on a tint picked from the id ──── */

function hueFor(id: string): number {
  let h = 0
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return h % 360
}

export function AgentAvatar({ id, name, size = "md" }: { id: string; name?: string; size?: "sm" | "md" | "lg" }) {
  const letter = ((name ?? "").trim().match(/[\p{L}\p{N}]/u)?.[0] ?? "+").toUpperCase()
  return (
    <span
      aria-hidden
      style={{ "--h": String(hueFor(id || "new")) } as React.CSSProperties}
      className={clsx(
        "grid flex-none place-items-center font-semibold",
        "bg-[oklch(0.94_0.045_var(--h))] text-[oklch(0.42_0.13_var(--h))] dark:bg-[oklch(0.34_0.07_var(--h))] dark:text-[oklch(0.9_0.07_var(--h))]",
        size === "sm" && "h-7 w-7 rounded-lg text-[12px]",
        size === "md" && "h-10 w-10 rounded-xl text-[15px]",
        size === "lg" && "h-12 w-12 rounded-2xl text-[18px]",
      )}
    >
      {letter}
    </span>
  )
}
