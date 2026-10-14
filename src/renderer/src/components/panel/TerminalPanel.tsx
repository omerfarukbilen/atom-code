import { useEffect, useRef } from 'react'
import { Plus, SquareTerminal, Trash2 } from 'lucide-react'
import { cn } from '../../lib/cn'
import { isMac } from '../../lib/platform'
import { useLayoutStore } from '../../stores/layout'
import { focusTerminal, TERMINAL_LIST_WIDTH, useTerminalStore, type TerminalInstance } from '../../stores/terminal'
import { useWorkspaceStore } from '../../stores/workspace'
import { Button, EmptyState, Kbd, Spinner } from '../ui'
import { XTerm } from './XTerm'

/** Display titles, numbered when several terminals share a shell name ("zsh", "zsh (2)"). */
export function terminalLabels(instances: TerminalInstance[]): Record<string, string> {
  const seen = new Map<string, number>()
  const out: Record<string, string> = {}
  for (const i of instances) {
    const n = (seen.get(i.title) ?? 0) + 1
    seen.set(i.title, n)
    out[i.id] = n > 1 ? `${i.title} (${n})` : i.title
  }
  return out
}

export function TerminalPanel() {
  const instances = useTerminalStore((s) => s.instances)
  const activeId = useTerminalStore((s) => s.activeId)
  const creating = useTerminalStore((s) => s.creating)
  const showing = useLayoutStore((s) => s.panelVisible && s.panelTab === 'terminal')
  const autoCreated = useRef(false)
  const labels = terminalLabels(instances)

  // Opening the terminal panel with no session starts one (VS Code behaviour) — once per page load. At startup
  // wait for the workspace to be restored so the shell starts in the project folder.
  useEffect(() => {
    if (!showing || instances.length || creating || autoCreated.current) return
    let unsubscribe: (() => void) | null = null
    const start = (): void => {
      if (autoCreated.current || useTerminalStore.getState().instances.length) return
      autoCreated.current = true
      const idle = !document.activeElement || document.activeElement === document.body
      void useTerminalStore.getState().create({ focus: idle })
    }
    const timer = setTimeout(() => {
      if (!useWorkspaceStore.getState().opening) return start()
      unsubscribe = useWorkspaceStore.subscribe((s) => {
        if (s.opening) return
        unsubscribe?.()
        unsubscribe = null
        start()
      })
    }, 300)
    return () => {
      clearTimeout(timer)
      unsubscribe?.()
    }
  }, [showing, instances.length, creating])

  const active = instances.find((i) => i.id === activeId) ?? null

  return (
    <div className="flex h-full min-h-0">
      <div
        data-terminal-viewport
        className="relative min-w-0 flex-1 bg-panel"
        onMouseDown={() => active && requestAnimationFrame(() => focusTerminal(active.id))}
      >
        {active ? (
          <XTerm key={active.id} id={active.id} />
        ) : creating ? (
          <div className="flex h-full items-center justify-center gap-2 text-[12px] text-subtle">
            <Spinner size={12} /> Starting shell…
          </div>
        ) : (
          <EmptyState
            icon={<SquareTerminal size={26} />}
            title="No terminal running"
            description={
              <>
                Start a shell in the workspace folder. Toggle this panel with <Kbd keys={isMac ? 'ctrl+`' : 'mod+`'} />.
              </>
            }
            action={
              <Button size="sm" variant="primary" icon={<Plus size={13} />} onClick={() => void useTerminalStore.getState().create({ focus: true })}>
                New Terminal
              </Button>
            }
            className="h-full"
          />
        )}
      </div>
      {instances.length > 1 && (
        <div
          className="shrink-0 overflow-y-auto border-l border-line bg-panel py-1"
          style={{ width: TERMINAL_LIST_WIDTH }}
          role="tablist"
          aria-label="Terminals"
        >
          {instances.map((inst) => (
            <div
              key={inst.id}
              role="tab"
              aria-selected={inst.id === activeId}
              onClick={() => {
                useTerminalStore.getState().setActive(inst.id)
                requestAnimationFrame(() => focusTerminal(inst.id))
              }}
              className={cn(
                'group mx-1 flex h-[26px] items-center gap-2 rounded-md px-2 text-[12px]',
                inst.id === activeId ? 'bg-active text-fg' : 'text-muted hover:bg-hover hover:text-fg'
              )}
              title={`${inst.info.shell} — ${inst.info.cwd}`}
            >
              <SquareTerminal size={13} className={cn('shrink-0', inst.exitCode !== null ? 'text-subtle' : 'text-muted')} />
              <span className={cn('min-w-0 flex-1 truncate', inst.exitCode !== null && 'text-subtle line-through')}>{labels[inst.id]}</span>
              <button
                type="button"
                title="Kill Terminal"
                onClick={(e) => {
                  e.stopPropagation()
                  void useTerminalStore.getState().kill(inst.id)
                }}
                className="rounded p-0.5 text-subtle opacity-0 hover:bg-hover hover:text-danger group-hover:opacity-100"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
