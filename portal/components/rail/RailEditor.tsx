"use client"

import { useState } from "react"

import { Button, Icon } from "../ui"

/**
 * The shell every rail section shares: collapsed summary, expand, dirty tracking,
 * Save/Cancel, in-flight state, and error display.
 *
 * Sections supply only a body and a save function, so each one stays small enough to
 * read in one sitting — and a failed save in one section can't discard an edit in
 * another, because each section owns its own draft and its own request.
 */
export function RailEditor({
  label,
  summary,
  dirty,
  onSave,
  onCancel,
  children,
  disabled,
  saveLabel = "Save",
}: {
  label: string
  summary: React.ReactNode
  dirty: boolean
  onSave: () => Promise<void>
  onCancel?: () => void
  children: React.ReactNode
  disabled?: boolean
  saveLabel?: string
}) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setSaving(true)
    setError(null)
    try {
      await onSave()
      setOpen(false)
    } catch (e) {
      // Keep the draft and the panel open so the user can correct and retry. The API's
      // RFC-7807 `detail` is shown verbatim — it is usually specific enough to act on.
      setError(e instanceof Error ? e.message : "save failed")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="px-5 py-3.5">
      <button
        type="button"
        onClick={() => {
          if (open && onCancel) onCancel()
          setOpen((o) => !o)
          setError(null)
        }}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <span className="text-[13px] font-medium">{label}</span>
        <span className="flex min-w-0 items-center gap-1.5 text-[12px] text-muted-foreground">
          <span className="min-w-0 truncate">{summary}</span>
          <Icon name="chevron" className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-90" : ""}`} />
        </span>
      </button>

      {open && (
        <div className="mt-3 flex flex-col gap-2.5">
          {children}
          {error && (
            <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-2.5 py-1.5 text-[11.5px] text-destructive">
              {error}
            </p>
          )}
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="primary"
              disabled={saving || disabled || !dirty}
              onClick={save}
            >
              {saving ? "Saving…" : saveLabel}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={saving}
              onClick={() => {
                onCancel?.()
                setOpen(false)
                setError(null)
              }}
            >
              Cancel
            </Button>
            {dirty && !saving && (
              <span className="text-[10.5px] text-muted-foreground">unsaved</span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/** Shared control styling, so five sections don't drift apart visually. */
export const inputClass =
  "w-full rounded-lg border border-input bg-background px-3 py-2 text-[13px] shadow-[inset_0_1px_1px_oklch(0_0_0/0.03)] outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground/70 focus:border-brand focus:ring-3 focus:ring-ring/20"

export function CheckRow({
  checked,
  onChange,
  label,
  hint,
  right,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  hint?: string
  right?: React.ReactNode
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2 rounded-lg px-1.5 py-1.5 hover:bg-accent/60">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-3.5 w-3.5 flex-none accent-[var(--brand)]"
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[11.5px]">{label}</span>
        {hint && <span className="block truncate text-[10px] text-muted-foreground">{hint}</span>}
      </span>
      {right}
    </label>
  )
}
