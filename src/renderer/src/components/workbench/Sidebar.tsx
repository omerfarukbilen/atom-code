import { useEffect, useState, type ReactNode } from 'react'
import { cn } from '../../lib/cn'
import { useLayoutStore, type SidebarView } from '../../stores/layout'
import { HistoryPanel } from '../agent/HistoryPanel'
import { ExplorerView } from '../explorer/ExplorerView'
import { GitView } from '../git/GitView'
import { SearchView } from '../search/SearchView'
import { SkillsPanel } from '../skills/SkillsPanel'

const VIEWS: Record<SidebarView, () => ReactNode> = {
  explorer: () => <ExplorerView />,
  search: () => <SearchView />,
  git: () => <GitView />,
  history: () => <HistoryPanel />,
  skills: () => <SkillsPanel />
}

/**
 * Primary sidebar. Views are mounted lazily on first visit and then kept alive (hidden) so scroll
 * positions, inputs and expanded state survive switching between them.
 */
export function Sidebar() {
  const view = useLayoutStore((s) => s.sidebarView)
  const [mounted, setMounted] = useState<SidebarView[]>([view])

  useEffect(() => {
    setMounted((m) => (m.includes(view) ? m : [...m, view]))
  }, [view])

  return (
    <aside aria-label="Sidebar" className="group/sidebar relative flex h-full min-w-0 flex-col bg-sidebar">
      {mounted.map((v) => (
        <section key={v} aria-hidden={v !== view} className={cn('min-h-0 flex-1 flex-col', v === view ? 'flex' : 'hidden')}>
          {VIEWS[v]()}
        </section>
      ))}
    </aside>
  )
}
