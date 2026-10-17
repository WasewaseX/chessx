'use client'

// The "/" command palette for the coach chat: browse and complete every
// coach skill inline. Pure UI: the command catalog and filtering come from
// the client-safe catalog module, execution happens when the message is
// sent (the server routes /commands deterministically).

import { useMemo } from 'react'
import { matchingCommands, parseClientCommand, COMMAND_CATEGORIES, type CommandDef } from '@/lib/coach-commands-catalog'
import { cn } from '@/lib/utils'

/** The visible list for the current input: prefix matches while typing the
 * command, the single matched command while typing its arguments. */
export function buildCommandList(input: string): CommandDef[] {
  const t = input.trim()
  if (!t.startsWith('/')) return []
  if (/\s/.test(t)) {
    const parsed = parseClientCommand(t)
    return parsed ? [parsed.def] : []
  }
  return matchingCommands(t)
}

export function commandNeedsArgs(def: CommandDef, input: string): boolean {
  return Boolean(def.args) && !/\s/.test(input.trim())
}

interface Props {
  list: CommandDef[]
  highlight: number
  onHighlight: (i: number) => void
  onPick: (def: CommandDef) => void
  onClose: () => void
  className?: string
}

export function CommandPalette({ list, highlight, onHighlight, onPick, onClose, className }: Props) {
  const groups = useMemo(() => {
    const byCat = new Map<string, CommandDef[]>()
    for (const c of list) {
      const arr = byCat.get(c.category) ?? []
      arr.push(c)
      byCat.set(c.category, arr)
    }
    return COMMAND_CATEGORIES.filter((c) => byCat.has(c.id)).map((c) => ({
      label: c.label,
      items: byCat.get(c.id)!,
    }))
  }, [list])

  if (!list.length) return null

  let flatIndex = -1

  return (
    <div
      className={cn(
        'absolute bottom-full left-0 right-0 z-50 mb-2 max-h-72 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-lg scroll-slim',
        className,
      )}
      role="listbox"
      aria-label="Coach commands"
    >
      {groups.map((g) => (
        <div key={g.label}>
          <div className="px-2 pt-1.5 pb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{g.label}</div>
          {g.items.map((def) => {
            flatIndex++
            const i = flatIndex
            return (
              <button
                key={def.id}
                type="button"
                role="option"
                aria-selected={i === highlight}
                className={cn(
                  'flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition',
                  i === highlight ? 'bg-accent' : 'hover:bg-secondary',
                )}
                onMouseEnter={() => onHighlight(i)}
                onMouseDown={(e) => {
                  e.preventDefault()
                  onPick(def)
                }}
              >
                <span className="mt-0.5 shrink-0 font-mono text-xs font-bold text-primary">{def.cmd}</span>
                {def.args && <span className="mt-0.5 shrink-0 font-mono text-xs text-muted-foreground">{def.args}</span>}
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={def.desc}>
                  <span className="font-semibold text-foreground">{def.title}</span> · {def.desc}
                </span>
              </button>
            )
          })}
        </div>
      ))}
      <button
        type="button"
        className="mt-1 w-full border-t border-border/60 px-2 py-1.5 text-left text-[11px] text-muted-foreground hover:text-foreground"
        onMouseDown={(e) => {
          e.preventDefault()
          onClose()
        }}
      >
        Esc to hide · Tab to complete · Enter sends the command
      </button>
    </div>
  )
}
