import Link from "next/link"

import type { Agent } from "@/lib/types"
import { AccessBadge } from "./error-note"
import { AgentAvatar, Icon, Tag } from "./ui"

/** An agent you can use. What you may do with it is Fleet's caller-relative `access_level`. */
export function AgentCard({ agent, href }: { agent: Agent; href?: string }) {
  const computer = agent.backend?.type === "sandbox"
  const tools = agent.tools?.tools?.length ?? 0
  const shared = agent.permissions?.identity === "shared"
  return (
    <Link
      href={href ?? `/agents/${agent.id}`}
      className="group flex flex-col gap-3 rounded-2xl bg-card p-4 shadow-card ring-1 ring-border/60 transition-[box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:shadow-pop hover:ring-brand-border"
    >
      <div className="flex items-start gap-3">
        <AgentAvatar id={agent.id} name={agent.name} />
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 break-words text-[14px] font-semibold leading-snug tracking-tight group-hover:text-brand">{agent.name}</p>
          <p className="truncate text-[12px] text-muted-foreground">{agent.is_owner ? "Yours" : `by ${agent.owner?.name ?? "a colleague"}`}</p>
        </div>
      </div>
      {agent.description && <p className="line-clamp-2 text-[12.5px] leading-relaxed text-muted-foreground">{agent.description}</p>}
      <div className="mt-auto flex flex-wrap items-center gap-1.5">
        <Tag title={shared ? "Runs with the agent's own connections" : "Acts as you, with your own connected accounts"}>
          <Icon name={shared ? "swap" : "user"} className="h-3 w-3" />
          {shared ? "shared connections" : "acts as you"}
        </Tag>
        {tools > 0 && (
          <Tag>
            <Icon name="plug" className="h-3 w-3" />
            {tools} tool{tools === 1 ? "" : "s"}
          </Tag>
        )}
        {computer && (
          <Tag title="Has a computer (LangSmith sandbox)">
            <Icon name="monitor" className="h-3 w-3" />
            computer
          </Tag>
        )}
        <span className="ml-auto">
          <AccessBadge level={agent.access_level} owner={agent.is_owner} />
        </span>
      </div>
    </Link>
  )
}
