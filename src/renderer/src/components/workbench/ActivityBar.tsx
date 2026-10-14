import type { ReactNode } from 'react'
import { Files, GitBranch, History, Search, Settings, Sparkles } from 'lucide-react'
import { cn } from '../../lib/cn'
import { formatKeybinding } from '../../lib/platform'
import { useAuthStore } from '../../stores/auth'
import { useGitStore } from '../../stores/git'
import { useLayoutStore, type SidebarView } from '../../stores/layout'
import { AccountAvatar } from './AccountAvatar'

interface ActivityItem {
  view: SidebarView
  title: string
  keybinding?: string
  icon: ReactNode
}

const ICON = { size: 19, strokeWidth: 1.6 } as const

const ITEMS: ActivityItem[] = [
  { view: 'explorer', title: 'Explorer', keybinding: 'mod+shift+e', icon: <Files {...ICON} /> },
  { view: 'search', title: 'Search', keybinding: 'mod+shift+f', icon: <Search {...ICON} /> },
  { view: 'git', title: 'Source Control', keybinding: 'mod+shift+g', icon: <GitBranch {...ICON} /> },
  { view: 'history', title: 'Agent History', icon: <History {...ICON} /> },
  { view: 'skills', title: 'Skills, Agents & Commands', icon: <Sparkles {...ICON} /> }
]

/** 48 px vertical view switcher on the far left (VS Code style, accent indicator on the active view). */
export function ActivityBar() {
  const sidebarVisible = useLayoutStore((s) => s.sidebarVisible)
  const sidebarView = useLayoutStore((s) => s.sidebarView)
  const settingsOpen = useLayoutStore((s) => s.settingsOpen)
  const settingsSection = useLayoutStore((s) => s.settingsSection)
  const changeCount = useGitStore((s) => (s.status?.isRepo ? s.status.files.length : 0))
  const loggedIn = useAuthStore((s) => !!s.status?.loggedIn)
  const show = (view: SidebarView): void => {
    const l = useLayoutStore.getState()
    if (l.settingsOpen) l.closeSettings()
    l.showSidebarView(view)
  }

  return (
    <nav aria-label="Views" className="flex w-12 shrink-0 flex-col items-center justify-between bg-titlebar py-1">
      <div className="flex w-full flex-col items-center">
        {ITEMS.map((item) => (
          <ActivityButton
            key={item.view}
            title={item.keybinding ? `${item.title} (${formatKeybinding(item.keybinding)})` : item.title}
            active={sidebarVisible && sidebarView === item.view && !settingsOpen}
            badge={item.view === 'git' && changeCount > 0 ? (changeCount > 99 ? '99+' : String(changeCount)) : undefined}
            onClick={() => show(item.view)}
          >
            {item.icon}
          </ActivityButton>
        ))}
      </div>
      <div className="flex w-full flex-col items-center">
        <ActivityButton
          title={loggedIn ? 'Account' : 'Sign in to Claude'}
          active={settingsOpen && settingsSection === 'account'}
          dot={!loggedIn}
          onClick={() => useLayoutStore.getState().openSettings('account')}
        >
          <AccountAvatar size={20} />
        </ActivityButton>
        <ActivityButton
          title={`Settings (${formatKeybinding('mod+,')})`}
          active={settingsOpen && settingsSection !== 'account'}
          onClick={() => {
            const l = useLayoutStore.getState()
            if (l.settingsOpen && l.settingsSection !== 'account') l.closeSettings()
            else l.openSettings(l.settingsSection === 'account' ? 'agent' : undefined)
          }}
        >
          <Settings {...ICON} />
        </ActivityButton>
      </div>
    </nav>
  )
}

function ActivityButton({ title, active, badge, dot, onClick, children }: { title: string; active: boolean; badge?: string; dot?: boolean; onClick(): void; children: ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      onClick={onClick}
      className={cn('relative flex h-11 w-12 items-center justify-center transition-colors duration-100', active ? 'text-fg' : 'text-subtle hover:text-fg')}
    >
      <span className={cn('absolute left-0 top-1/2 w-[2px] -translate-y-1/2 rounded-r bg-accent transition-all duration-150', active ? 'h-6 opacity-100' : 'h-0 opacity-0')} />
      {children}
      {badge && (
        <span className="absolute bottom-[7px] right-[7px] flex h-[15px] min-w-[15px] items-center justify-center rounded-full bg-accent px-1 text-[9.5px] font-semibold leading-none text-accent-fg shadow-sm">
          {badge}
        </span>
      )}
      {dot && <span className="absolute right-[13px] top-[11px] h-2 w-2 rounded-full border-2 border-titlebar bg-warning" />}
    </button>
  )
}
