import { ApiError } from "@/lib/api"

/**
 * An error that says who refused, and why. "Enforced by LangSmith" means a native
 * control the platform team configured (role, access policy, model access, spend cap);
 * "Portal" means this app's own check.
 */
export function ErrorNote({ error, className }: { error: unknown; className?: string }) {
  if (!error) return null
  const api = error instanceof ApiError ? error : null
  const detail = error instanceof Error ? error.message : String(error)
  return (
    <div className={`rounded-xl border border-destructive/30 bg-destructive/5 px-3.5 py-2.5 text-[12.5px] ${className ?? ""}`} role="alert">
      <div className="flex flex-wrap items-center gap-2">
        {api?.enforcedBy && (
          <span className="rounded-full border border-destructive/40 px-1.5 text-[10px] font-semibold uppercase tracking-wider text-destructive">
            {api.enforcedBy === "langsmith" ? "Enforced by LangSmith" : "Portal"}
          </span>
        )}
        <span className="text-destructive">{api?.hint ?? detail}</span>
      </div>
      {api?.hint && <p className="mt-1 font-mono text-[11px] text-muted-foreground">{detail}</p>}
    </div>
  )
}

export function AccessBadge({ level, owner }: { level?: string; owner?: boolean }) {
  const label = owner ? "Owner" : level === "write" ? "Can edit" : level === "run" ? "Can run" : level === "read" ? "Can clone" : "—"
  return (
    <span
      title="Your access, as LangSmith resolves it for you"
      className={`inline-flex h-5 flex-none items-center rounded-full px-2 text-[10.5px] font-medium ${
        owner ? "bg-brand-subtle text-brand" : "bg-secondary text-muted-foreground dark:bg-accent"
      }`}
    >
      {label}
    </span>
  )
}
