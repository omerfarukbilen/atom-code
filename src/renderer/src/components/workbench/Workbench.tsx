import { useEffect, useRef, type RefObject } from 'react'
import { Group, Panel, Separator, useGroupRef, usePanelRef, type Layout, type LayoutChangedMeta, type PanelImperativeHandle, type PanelSize } from 'react-resizable-panels'
import { useLayoutStore } from '../../stores/layout'
import { AgentPanel } from '../agent/AgentPanel'
import { EditorArea } from '../editor/EditorArea'
import { BottomPanel } from '../panel/BottomPanel'
import { ActivityBar } from './ActivityBar'
import { Sidebar } from './Sidebar'
import { StatusBar } from './StatusBar'
import { TitleBar } from './TitleBar'

/**
 * Workbench layout:  TitleBar / [ActivityBar | Sidebar | (Editor / Panel) | Agent] / StatusBar.
 *
 * Panel visibility lives in the layout store; the collapsible panels are collapsed/expanded imperatively
 * so their sizes are kept. Last expanded sizes are persisted in localStorage.
 */
const SIZES_KEY = 'atom.workbench.sizes.v1'

interface StoredSizes {
  sidebar: number
  agent: number | null
  panel: number | null
}

function loadSizes(): StoredSizes {
  const fallback: StoredSizes = { sidebar: 260, agent: null, panel: null }
  try {
    const raw = JSON.parse(localStorage.getItem(SIZES_KEY) ?? '{}') as Partial<StoredSizes>
    return {
      sidebar: typeof raw.sidebar === 'number' && raw.sidebar >= 170 ? raw.sidebar : fallback.sidebar,
      agent: typeof raw.agent === 'number' && raw.agent >= 320 ? raw.agent : null,
      panel: typeof raw.panel === 'number' && raw.panel >= 100 ? raw.panel : null
    }
  } catch {
    return fallback
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null
function saveSizes(sizes: StoredSizes): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(SIZES_KEY, JSON.stringify(sizes))
    } catch {
      /* storage unavailable */
    }
  }, 250)
}

const AGENT_DEFAULT = '32%'
const PANEL_DEFAULT = '32%'

export function Workbench() {
  const sizes = useRef<StoredSizes>(loadSizes())
  // Initial visibility is read once; later changes go through the imperative handles.
  const initial = useRef(useLayoutStore.getState())

  const groupRef = useGroupRef()
  const sidebarRef = usePanelRef()
  const agentRef = usePanelRef()
  const bottomRef = usePanelRef()
  /** Main-group layout (percentages) before the agent was maximized. */
  const preMaximize = useRef<Record<string, number> | null>(null)

  const sidebarVisible = useLayoutStore((s) => s.sidebarVisible)
  const panelVisible = useLayoutStore((s) => s.panelVisible)
  const agentVisible = useLayoutStore((s) => s.agentVisible)
  const agentMaximized = useLayoutStore((s) => s.agentMaximized)

  /** Width of the main group in px (for converting px sizes to the percentages setLayout expects). */
  const groupEl = useRef<HTMLDivElement | null>(null)

  // ── Sidebar ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const group = groupRef.current
    const width = groupEl.current?.offsetWidth ?? 0
    if (useLayoutStore.getState().agentMaximized && group && width > 0 && 'center' in group.getLayout()) {
      // In the agent layout the editor is collapsed, so the sidebar trades space with the agent directly.
      const sidebar = sidebarVisible ? Math.min(45, (sizes.current.sidebar / width) * 100) : 0
      group.setLayout({ sidebar, center: 0, agent: 100 - sidebar })
      return
    }
    syncCollapsible(sidebarRef, sidebarVisible, sizes.current.sidebar)
  }, [sidebarVisible, sidebarRef, groupRef])

  // ── Bottom panel ──────────────────────────────────────────────────────────
  useEffect(() => {
    syncCollapsible(bottomRef, panelVisible, sizes.current.panel ?? PANEL_DEFAULT)
  }, [panelVisible, bottomRef])

  // ── Agent + maximized agent layout ────────────────────────────────────────
  useEffect(() => {
    if (agentMaximized && !agentVisible) {
      // Hiding the agent leaves the maximized layout.
      useLayoutStore.setState({ agentMaximized: false })
      return
    }
    const apply = (): boolean => {
      const group = groupRef.current
      if (!group || !agentRef.current) return false
      const layout = group.getLayout()
      if (!('center' in layout)) return false // group not measured yet
      const sidebar = layout.sidebar ?? 0
      if (agentMaximized) {
        if (layout.center > 0.5) preMaximize.current = layout
        group.setLayout({ sidebar, center: 0, agent: 100 - sidebar })
        return true
      }
      if (layout.center <= 0.1) {
        // Leaving the agent layout: restore the previous editor/agent split.
        const rest = 100 - sidebar
        const saved = preMaximize.current
        let agentShare = 0.34
        if (saved && (saved.center ?? 0) + (saved.agent ?? 0) > 0) agentShare = (saved.agent ?? 0) / ((saved.center ?? 0) + (saved.agent ?? 0))
        if (!agentVisible) agentShare = 0
        group.setLayout({ sidebar, center: rest * (1 - agentShare), agent: rest * agentShare })
        return true
      }
      syncCollapsible(agentRef, agentVisible, sizes.current.agent ?? AGENT_DEFAULT)
      return true
    }
    // Right after mount the group may not be measured yet — retry for a few frames.
    let frame = 0
    let tries = 0
    const attempt = (): void => {
      if (!apply() && tries++ < 60) frame = requestAnimationFrame(attempt)
    }
    attempt()
    return () => cancelAnimationFrame(frame)
  }, [agentVisible, agentMaximized, groupRef, agentRef])

  // ── Resize callbacks: remember sizes and reflect drag-collapses in the store ─
  const onSidebarResize = (size: PanelSize, _id: string | number | undefined, prev: PanelSize | undefined): void => {
    if (size.inPixels >= 170) {
      sizes.current = { ...sizes.current, sidebar: Math.round(size.inPixels) }
      saveSizes(sizes.current)
    }
    if (!prev) return
    const visible = size.asPercentage > 0.1
    if (visible !== useLayoutStore.getState().sidebarVisible) useLayoutStore.setState({ sidebarVisible: visible })
  }

  const onAgentResize = (size: PanelSize, _id: string | number | undefined, prev: PanelSize | undefined): void => {
    const l = useLayoutStore.getState()
    if (size.inPixels >= 320 && !l.agentMaximized) {
      sizes.current = { ...sizes.current, agent: Math.round(size.inPixels) }
      saveSizes(sizes.current)
    }
    if (!prev) return
    const visible = size.asPercentage > 0.1
    if (visible !== l.agentVisible && !l.agentMaximized) useLayoutStore.setState({ agentVisible: visible })
  }

  const onMainLayoutChanged = (layout: Layout, meta: LayoutChangedMeta): void => {
    if (!meta.isUserInteraction || !('center' in layout)) return
    const l = useLayoutStore.getState()
    const collapsed = layout.center <= 0.1
    // Dragging the editor away entirely is the same as maximizing the agent, and vice versa.
    if (collapsed && !l.agentMaximized && l.agentVisible) useLayoutStore.setState({ agentMaximized: true })
    else if (!collapsed && l.agentMaximized) useLayoutStore.setState({ agentMaximized: false })
  }

  const onBottomResize = (size: PanelSize, _id: string | number | undefined, prev: PanelSize | undefined): void => {
    if (size.inPixels >= 100) {
      sizes.current = { ...sizes.current, panel: Math.round(size.inPixels) }
      saveSizes(sizes.current)
    }
    if (!prev) return
    const visible = size.asPercentage > 0.1
    if (visible !== useLayoutStore.getState().panelVisible) useLayoutStore.setState({ panelVisible: visible })
  }

  const init = initial.current
  return (
    <div className="flex h-full w-full flex-col bg-app text-fg">
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        <ActivityBar />
        <Group
          orientation="horizontal"
          groupRef={groupRef}
          elementRef={groupEl}
          id="atom-main"
          className="min-w-0 flex-1"
          onLayoutChanged={onMainLayoutChanged}
        >
          <Panel
            id="sidebar"
            panelRef={sidebarRef}
            collapsible
            collapsedSize={0}
            minSize={170}
            maxSize="45%"
            defaultSize={init.sidebarVisible ? sizes.current.sidebar : 0}
            groupResizeBehavior="preserve-pixel-size"
            onResize={onSidebarResize}
          >
            <Sidebar />
          </Panel>
          <Separator id="sep-sidebar" />
          <Panel
            id="center"
            collapsible
            collapsedSize={0}
            minSize={260}
            groupResizeBehavior={agentMaximized ? 'preserve-pixel-size' : 'preserve-relative-size'}
          >
            <Group orientation="vertical" id="atom-center" className="h-full">
              <Panel id="editor" minSize={120}>
                <div className="h-full min-h-0 bg-app">
                  <EditorArea />
                </div>
              </Panel>
              <Separator id="sep-panel" />
              <Panel
                id="panel"
                panelRef={bottomRef}
                collapsible
                collapsedSize={0}
                minSize={100}
                defaultSize={init.panelVisible ? (sizes.current.panel ?? PANEL_DEFAULT) : 0}
                groupResizeBehavior="preserve-pixel-size"
                onResize={onBottomResize}
              >
                <div className="h-full min-h-0 bg-panel">
                  <BottomPanel />
                </div>
              </Panel>
            </Group>
          </Panel>
          <Separator id="sep-agent" />
          <Panel
            id="agent"
            panelRef={agentRef}
            collapsible
            collapsedSize={0}
            minSize={320}
            defaultSize={init.agentVisible && !init.agentMaximized ? (sizes.current.agent ?? AGENT_DEFAULT) : init.agentMaximized ? AGENT_DEFAULT : 0}
            groupResizeBehavior={agentMaximized ? 'preserve-relative-size' : 'preserve-pixel-size'}
            onResize={onAgentResize}
          >
            <div className="h-full min-h-0 bg-panel">
              <AgentPanel />
            </div>
          </Panel>
        </Group>
      </div>
      <StatusBar />
    </div>
  )
}

/** Collapse / expand a collapsible panel to match `visible`, restoring `size` when expanding. */
function syncCollapsible(ref: RefObject<PanelImperativeHandle | null>, visible: boolean, size: number | string): void {
  const panel = ref.current
  if (!panel) return
  const collapsed = panel.isCollapsed()
  if (visible && collapsed) panel.resize(size)
  else if (!visible && !collapsed) panel.collapse()
}
