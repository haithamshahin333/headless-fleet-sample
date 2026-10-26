import clsx from "clsx"

import type { Me } from "@/lib/types"

/** Shown instead of Build/Publish pages to someone without a builder role, or to everyone when none is configured. */
export function BuilderOnly({ me, what, className }: { me: Me; what: string; className?: string }) {
  return (
    <p className={clsx("text-[13px] text-muted-foreground", className)}>
      {me.build_enabled
        ? `${what} is limited to the builder role. Ask your platform team for access.`
        : "Build and Publish are turned off in this portal: no builder roles are configured. Your platform team sets them (Helm value roles.builders)."}
    </p>
  )
}
