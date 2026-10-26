"use client"

import { useEffect, useState } from "react"

import { putTools, type ToolDraft } from "@/lib/api"
import type { Agent, Context } from "@/lib/types"
import { Button } from "../../ui"
import { CheckRow, RailEditor } from "../RailEditor"
import { ToolPicker } from "../ToolPicker"

/**
 * The agent's tool set: what is attached, and whether each pauses for approval.
 *
 * Browsing and choosing happens in `ToolPicker`, a dialog — twenty servers with real
 * descriptions do not fit a 256px rail, and a native select escaped it and covered the
 * chat. This section keeps only the part that belongs in the rail: the current set, the
 * approval toggles, and Save.
 *
 * The one upstream rule that shapes it: `tools` REPLACES `tools.json` wholesale, so the
 * draft is seeded from the agent's current set and always submitted complete, never as a
 * delta.
 */
export function ToolsSection({
  agent,
  ctx,
  onSaved,
}: {
  agent: Agent
  ctx: Context | null
  onSaved: (a: Agent) => void
}) {
  const current: ToolDraft[] = (agent.tools?.tools ?? []).map((t) => ({
    name: t.name,
    mcp_server_url: t.mcp_server_url ?? "",
    mcp_server_name: t.mcp_server_name ?? "",
    require_approval: Boolean((agent.tools?.interrupt_config ?? {})[t.name]),
  }))
  const key = JSON.stringify(current)

  const [draft, setDraft] = useState<ToolDraft[]>(current)
  const [picking, setPicking] = useState(false)

  useEffect(() => setDraft(JSON.parse(key)), [key])

  /** Merge the picker's selection in, ignoring anything already attached. */
  function addTools(chosen: ToolDraft[]) {
    setDraft((prev) => {
      const have = new Set(prev.map((p) => p.name))
      return [...prev, ...chosen.filter((c) => !have.has(c.name))]
    })
  }

  return (
    <RailEditor
      label="Tools"
      summary={`${draft.length}`}
      dirty={JSON.stringify(draft) !== key}
      onCancel={() => setDraft(JSON.parse(key))}
      onSave={async () => onSaved(await putTools(agent.id, draft))}
    >
      {draft.length > 0 && (
        <div className="flex flex-col gap-0.5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Attached
          </p>
          {draft.map((d) => (
            <CheckRow
              key={d.name}
              checked
              onChange={() => setDraft((p) => p.filter((x) => x.name !== d.name))}
              label={d.name}
              hint={d.mcp_server_name || d.mcp_server_url}
              right={
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault()
                    setDraft((p) =>
                      p.map((x) =>
                        x.name === d.name ? { ...x, require_approval: !x.require_approval } : x,
                      ),
                    )
                  }}
                  className={`flex-none rounded-full border px-1.5 text-[9.5px] ${
                    d.require_approval
                      ? "border-brand-border bg-brand-subtle text-brand"
                      : "text-muted-foreground"
                  }`}
                  title="Require human approval before this tool runs"
                >
                  {d.require_approval ? "approval" : "auto"}
                </button>
              }
            />
          ))}
        </div>
      )}

      <Button size="sm" variant="default" onClick={() => setPicking(true)}>
        ＋ Add tools…
      </Button>

      {picking && (
        <ToolPicker
          integrations={ctx?.integrations ?? []}
          attached={draft}
          bindAgentId={agent.permissions?.identity === "shared" ? agent.id : undefined}
          onClose={() => setPicking(false)}
          onAdd={addTools}
        />
      )}

      <p className="text-[10px] leading-relaxed text-muted-foreground">
        Saving replaces the whole tool set. Tools marked{" "}
        <span className="text-brand">approval</span> pause the run for a human before they
        execute.
      </p>
    </RailEditor>
  )
}
