"use client"

import type { Todo } from "@/lib/types"

/**
 * Live plan, the way the Fleet UI shows it.
 *
 * A deep agent that calls `write_todos` puts its plan in thread state under `todos`
 * (`{content, status}` per item). Without this the only sign of planning is an opaque
 * `write_todos` tool marker, which tells a viewer nothing about progress.
 */
const DOT: Record<string, { ring: string; fill: string }> = {
  completed: { ring: "border-transparent", fill: "oklch(0.52 0.13 155)" },
  in_progress: { ring: "border-transparent", fill: "var(--brand)" },
  pending: { ring: "border-muted-foreground/40", fill: "transparent" },
}

export function TodoPanel({ todos }: { todos: Todo[] }) {
  if (todos.length === 0) return null
  const done = todos.filter((t) => t.status === "completed").length
  const active = todos.findIndex((t) => t.status === "in_progress")

  return (
    <div className="max-w-[62ch] rounded-xl bg-muted/60 p-3.5 ring-1 ring-border/50">
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Plan
        </p>
        <p className="text-[11px] text-muted-foreground">
          {done} of {todos.length} done
        </p>
      </div>

      {/* One bar rather than per-item percentages: it reads at a glance. */}
      <div className="mb-3 h-1 overflow-hidden rounded-full bg-border">
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{ width: `${(done / todos.length) * 100}%`, background: "var(--brand)" }}
        />
      </div>

      <ol className="flex flex-col gap-1.5">
        {todos.map((t, i) => {
          const style = DOT[t.status ?? "pending"] ?? DOT.pending
          return (
            <li key={`${i}-${t.content}`} className="flex items-start gap-2.5 text-[12.5px]">
              <span
                aria-hidden
                className={`mt-[0.3rem] h-2.5 w-2.5 flex-none rounded-full border-2 ${style.ring}`}
                style={{ background: style.fill }}
              />
              <span
                className={
                  t.status === "completed"
                    ? "text-muted-foreground line-through decoration-muted-foreground/40"
                    : i === active
                      ? "font-medium"
                      : "text-muted-foreground"
                }
              >
                {t.content}
              </span>
              {i === active && (
                <span className="ml-auto flex-none text-[10.5px] text-brand">working</span>
              )}
            </li>
          )
        })}
      </ol>
    </div>
  )
}
