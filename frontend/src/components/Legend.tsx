import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'

import { TYPE_ICONS } from '@/components/typeIcons'
import { PROTOCOL_VISUALS, TYPE_VISUALS } from '@/lib/graph'
import { COMPONENT_TYPES, PROTOCOLS } from '@/lib/types'
import { DESKTOP_QUERY, useMediaQuery } from '@/hooks/useMediaQuery'
import { cn } from '@/lib/utils'

/** Explains the node categories and protocol styling used on the canvas. */
export function Legend() {
  // Starts collapsed on narrow viewports so it never covers the graph; the
  // header stays visible so it can always be reopened.
  const isDesktop = useMediaQuery(DESKTOP_QUERY)
  const [open, setOpen] = useState(isDesktop)

  return (
    <div className="pointer-events-auto absolute bottom-3 left-3 z-10 w-[196px] rounded-lg border border-border bg-card/95 shadow-xl backdrop-blur sm:w-[232px]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground transition hover:text-foreground"
      >
        Legend
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
      </button>
      {open ? (
        <div className="space-y-2 border-t border-border px-3 py-2.5">
          <ul className="space-y-1.5">
            {COMPONENT_TYPES.map((type) => {
              const Icon = TYPE_ICONS[type]
              const visual = TYPE_VISUALS[type]
              return (
                <li key={type} className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  <span
                    className={cn(
                      'flex h-5 w-5 items-center justify-center rounded border',
                      visual.chip,
                    )}
                  >
                    <Icon className="h-3 w-3" />
                  </span>
                  {visual.label}
                </li>
              )
            })}
          </ul>
          <div className="border-t border-border pt-2">
            <div className="mb-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
              Protocols
            </div>
            <ul className="flex flex-wrap gap-1">
              {PROTOCOLS.map((protocol) => (
                <li
                  key={protocol}
                  className={cn(
                    'rounded border px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider',
                    PROTOCOL_VISUALS[protocol].badge,
                  )}
                >
                  {PROTOCOL_VISUALS[protocol].short}
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </div>
  )
}
