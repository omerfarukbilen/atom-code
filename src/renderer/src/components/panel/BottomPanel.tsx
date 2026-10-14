import { useCallback, useEffect, useRef, type ReactNode, type RefObject } from 'react'
import { Eraser, Maximize2, Minimize2, Plus, SquareTerminal, Trash2, X } from 'lucide-react'
import { cn } from '../../lib/cn'
import { isMac } from '../../lib/platform'
import { useEditorStore } from '../../stores/editor'
import { useLayoutStore, type PanelTab } from '../../stores/layout'
import { useOutputStore } from '../../stores/output'
import { registerPanelMaximizeHandler, usePanelUiStore, useTerminalStore } from '../../stores/terminal'
import { IconButton } from '../ui'
import { OutputPanel } from './OutputPanel'
import { ProblemsPanel } from './ProblemsPanel'
import { TerminalPanel, terminalLabels } from './TerminalPanel'

/**
 * Maximize/restore drives the resizable-panels separator above this panel through its keyboard API
 * (Home = shrink the editor to its minimum), so it works without access to the workbench's panel refs.
 */
function useMaximize(rootRef: RefObject<HTMLDivElement | null>): () => void {
  const restoreFraction = useRef<number | null>(null)

  const elements = useCallback(() => {
    const panel = rootRef.current?.closest<HTMLElement>('[data-panel]') ?? null
    const separator = panel?.previousElementSibling as HTMLElement | null
    const editor = separator?.previousElementSibling as HTMLElement | null
    const group = panel?.parentElement ?? null
    if (!panel || !group || !separator?.hasAttribute('data-separator') || !editor?.hasAttribute('data-panel')) return null
    return { panel, separator, editor, group }
  }, [rootRef])

  // Reflect the measured state (also when the user drags the separator).
  useEffect(() => {
    const els = elements()
    if (!els) return
    const update = (): void => {
      const editorH = els.editor.getBoundingClientRect().height
      const panelH = els.panel.getBoundingClientRect().height
      usePanelUiStore.getState().setMaximized(panelH > 160 && editorH <= 160)
    }
    const ro = new ResizeObserver(update)
    ro.observe(els.editor)
    ro.observe(els.panel)
    update()
    return () => ro.disconnect()
  }, [elements])

  return useCallback(() => {
    const els = elements()
    if (!els) {
      window.dispatchEvent(new CustomEvent('atom:panel-maximize', { detail: { maximized: !usePanelUiStore.getState().maximized } }))
      return
    }
    const press = (key: string): void => {
      els.separator.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
    }
    const groupH = els.group.getBoundingClientRect().height || 1
    const panelH = els.panel.getBoundingClientRect().height
    if (usePanelUiStore.getState().maximized) {
      const target = restoreFraction.current ?? 0.32
      const steps = Math.round(((panelH / groupH - target) * 100) / 5)
      for (let i = 0; i < Math.abs(steps); i++) press(steps > 0 ? 'ArrowDown' : 'ArrowUp')
      restoreFraction.current = null
    } else {
      if (!useLayoutStore.getState().panelVisible) useLayoutStore.getState().setPanelVisible(true)
      restoreFraction.current = panelH > 40 ? panelH / groupH : 0.32
      press('Home')
    }
  }, [elements])
}

function PanelTabButton({ id, label, active, children }: { id: PanelTab; label: string; active: boolean; children?: ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={() => useLayoutStore.getState().showPanel(id)}
      className={cn(
        'relative flex h-full items-center gap-1.5 px-2 text-[11px] font-medium uppercase tracking-[0.06em] transition-colors',
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
  const unread = useOutputStore((s) => s.unread)
  const instances = useTerminalStore((s) => s.instances)
  const activeTerminal = useTerminalStore((s) => s.activeId)
  const maximized = usePanelUiStore((s) => s.maximized)
  const rootRef = useRef<HTMLDivElement>(null)
  const toggleMaximize = useMaximize(rootRef)

  useEffect(() => registerPanelMaximizeHandler(toggleMaximize), [toggleMaximize])

  const problems = counts.errors + counts.warnings
  const labels = terminalLabels(instances)
  const single = instances.length === 1 ? instances[0] : null

  return (
    <div ref={rootRef} className="flex h-full min-h-0 flex-col bg-panel">
      <div className="flex h-[35px] shrink-0 items-center gap-1 border-b border-line pl-2 pr-1.5" role="tablist">
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
          {unread > 0 && tab !== 'output' && <span className="h-1.5 w-1.5 rounded-full bg-accent" title={`${unread} new lines`} />}
        </PanelTabButton>

        <div className="ml-auto flex items-center gap-0.5">
          {tab === 'terminal' && (
            <>
              {single && (
                <span className="mr-1 flex items-center gap-1.5 rounded-md px-1.5 text-[11.5px] text-muted" title={`${single.info.shell} — ${single.info.cwd}`}>
                  <SquareTerminal size={13} /> {labels[single.id]}
                </span>
              )}
              <IconButton
                title={`New Terminal (${isMac ? '⌃⇧`' : 'Ctrl+Shift+`'})`}
                icon={<Plus size={15} />}
                onClick={() => void useTerminalStore.getState().create({ focus: true })}
              />
              <IconButton title="Clear Terminal" icon={<Eraser size={14} />} disabled={!activeTerminal} onClick={() => useTerminalStore.getState().clear()} />
              <IconButton
                title="Kill Terminal"
                icon={<Trash2 size={14} />}
                disabled={!activeTerminal}
                onClick={() => activeTerminal && void useTerminalStore.getState().kill(activeTerminal)}
              />
            </>
          )}
          {tab === 'output' && <IconButton title="Clear Output" icon={<Eraser size={14} />} onClick={() => useOutputStore.getState().clear()} />}
          <div className="mx-1 h-4 w-px bg-line" />
          <IconButton title={maximized ? 'Restore Panel Size' : 'Maximize Panel'} icon={maximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />} onClick={toggleMaximize} />
          <IconButton title="Close Panel" icon={<X size={15} />} onClick={() => useLayoutStore.getState().setPanelVisible(false)} />
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
