import type { ReactNode } from 'react'
import { Eraser, Maximize2, Minimize2, MoreHorizontal, Plus, SquareTerminal, Trash2, X } from 'lucide-react'
import { cn } from '../../lib/cn'
import { formatKeybinding, isMac } from '../../lib/platform'
import { useEditorStore } from '../../stores/editor'
import { useLayoutStore, type PanelTab } from '../../stores/layout'
import { useOutputStore } from '../../stores/output'
import { usePanelUiStore, useTerminalStore } from '../../stores/terminal'
import { IconButton, Menu, useMenu, type MenuEntry } from '../ui'
import { OutputPanel } from './OutputPanel'
import { ProblemsPanel } from './ProblemsPanel'
import { TerminalPanel, terminalLabels } from './TerminalPanel'

function PanelTabButton({ id, label, active, children }: { id: PanelTab; label: string; active: boolean; children?: ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={() => useLayoutStore.getState().showPanel(id)}
      className={cn(
        'relative flex h-full shrink-0 items-center gap-1.5 px-1.5 text-[11px] font-medium uppercase tracking-[0.06em] transition-colors @sm:px-2',
        active ? 'text-fg' : 'text-subtle hover:text-muted'
      )}
    >
      {label}
      {children}
      {active && <span className="absolute inset-x-2 bottom-0 h-px bg-accent" />}
    </button>
  )
}

/** Bottom panel: Terminal / Problems / Output. */
export function BottomPanel() {
  const tab = useLayoutStore((s) => s.panelTab)
  const counts = useEditorStore((s) => s.diagnosticCounts)
  // Boolean selector: the unread count changes on every flushed batch of agent output.
  const hasUnread = useOutputStore((s) => s.unread > 0)
  const instances = useTerminalStore((s) => s.instances)
  const activeTerminal = useTerminalStore((s) => s.activeId)
  const maximized = usePanelUiStore((s) => s.maximized)
  const toggleMaximize = (): void => usePanelUiStore.getState().toggleMaximized()

  const problems = counts.errors + counts.warnings
  const labels = terminalLabels(instances)
  const single = instances.length === 1 ? instances[0] : null
  const newTerminalTitle = `New Terminal (${formatKeybinding(isMac ? 'ctrl+shift+`' : 'mod+shift+`')})`
  const newTerminal = (): void => void useTerminalStore.getState().create({ focus: true })
  const clearTerminal = (): void => useTerminalStore.getState().clear()
  const killTerminal = (): void => {
    if (activeTerminal) void useTerminalStore.getState().kill(activeTerminal)
  }
  // In a narrow editor column the secondary terminal actions move into a "…" menu, so Maximize and Close
  // always stay reachable.
  const more = useMenu('bottom-end')
  const moreEntries: MenuEntry[] = [
    { id: 'new', label: 'New Terminal', icon: <Plus size={14} />, shortcut: isMac ? 'ctrl+shift+`' : 'mod+shift+`', onSelect: newTerminal },
    { id: 'clear', label: 'Clear Terminal', icon: <Eraser size={14} />, disabled: !activeTerminal, onSelect: clearTerminal },
    { id: 'kill', label: 'Kill Terminal', icon: <Trash2 size={14} />, disabled: !activeTerminal, danger: true, onSelect: killTerminal }
  ]

  return (
    <div className="flex h-full min-h-0 flex-col bg-panel">
      <div className="@container flex h-[35px] shrink-0 items-center gap-1 border-b border-line pl-1.5 pr-1.5 @sm:pl-2">
        <div className="flex h-full min-w-0 flex-1 items-center gap-1 overflow-hidden" role="tablist">
          <PanelTabButton id="terminal" label="Terminal" active={tab === 'terminal'} />
          <PanelTabButton id="problems" label="Problems" active={tab === 'problems'}>
            {problems > 0 && (
              <span
                className={cn(
                  'rounded-full px-1.5 text-[10px] font-semibold leading-4 tracking-normal',
                  counts.errors > 0 ? 'bg-danger-soft text-danger' : 'bg-warning-soft text-warning'
                )}
              >
                {problems > 99 ? '99+' : problems}
              </span>
            )}
          </PanelTabButton>
          <PanelTabButton id="output" label="Output" active={tab === 'output'}>
            {hasUnread && tab !== 'output' && <span className="h-1.5 w-1.5 rounded-full bg-accent" title="New output" />}
          </PanelTabButton>
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          {tab === 'terminal' && (
            <>
              {single && (
                <span
                  className="mr-1 hidden max-w-[140px] items-center gap-1.5 rounded-md px-1.5 text-[11.5px] text-muted @xl:flex"
                  title={`${single.info.shell} — ${single.info.cwd}`}
                >
                  <SquareTerminal size={13} className="shrink-0" /> <span className="truncate">{labels[single.id]}</span>
                </span>
              )}
              <span className="hidden items-center gap-0.5 @md:flex">
                <IconButton title={newTerminalTitle} icon={<Plus size={15} />} onClick={newTerminal} />
                <IconButton title="Clear Terminal" icon={<Eraser size={14} />} disabled={!activeTerminal} onClick={clearTerminal} />
                <IconButton title="Kill Terminal" icon={<Trash2 size={14} />} disabled={!activeTerminal} onClick={killTerminal} />
              </span>
              <span className="flex @md:hidden">
                <IconButton title="Terminal Actions" icon={<MoreHorizontal size={15} />} active={more.open} onClick={more.openFromEvent} />
              </span>
              <Menu {...more.props} entries={moreEntries} minWidth={210} />
            </>
          )}
          {tab === 'output' && <IconButton title="Clear Output" icon={<Eraser size={14} />} onClick={() => useOutputStore.getState().clear()} />}
          <div className="mx-1 h-4 w-px bg-line" />
          <IconButton title={maximized ? 'Restore Panel Size' : 'Maximize Panel'} icon={maximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />} onClick={toggleMaximize} />
          <IconButton title={`Close Panel (${formatKeybinding('mod+j')})`} icon={<X size={15} />} onClick={() => useLayoutStore.getState().setPanelVisible(false)} />
        </div>
      </div>
      <div className="min-h-0 flex-1">
        {/* Terminal stays mounted so sessions keep rendering while other tabs are shown. */}
        <div className={cn('h-full', tab !== 'terminal' && 'hidden')}>
          <TerminalPanel />
        </div>
        {tab === 'problems' && <ProblemsPanel />}
        {tab === 'output' && <OutputPanel />}
      </div>
    </div>
  )
}
