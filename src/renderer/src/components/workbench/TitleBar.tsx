import { ChevronDown, FolderOpen, FolderX, Maximize2, Minimize2, PanelBottom, PanelLeft, PanelRight, Search } from 'lucide-react'
import { basename } from '@shared/paths'
import { cn } from '../../lib/cn'
import { formatKeybinding, isMac } from '../../lib/platform'
import { useAuthStore } from '../../stores/auth'
import { useLayoutStore } from '../../stores/layout'
import { useSettingsStore } from '../../stores/settings'
import { useWorkspaceStore } from '../../stores/workspace'
import { AtomLogo, IconButton, Kbd, Menu, useMenu, type MenuEntry } from '../ui'
import { AccountAvatar } from './AccountAvatar'
import { togglePanel } from './commands'

/**
 * 38 px custom title bar. The whole bar is a window drag region; interactive children opt out with
 * `.no-drag`. macOS reserves 78 px on the left for the traffic lights; Windows/Linux reserve 140 px on the
 * right for the native window-controls overlay.
 */
export function TitleBar() {
  return (
    <header
      className="drag relative flex h-[38px] shrink-0 items-center gap-2 border-b border-line bg-titlebar"
      style={{ paddingLeft: isMac ? 78 : 12, paddingRight: isMac ? 8 : 140 }}
    >
      <div className="flex min-w-0 shrink items-center gap-2">
        <AtomLogo size={16} className="shrink-0" />
        <span className="hidden shrink-0 text-[12px] font-semibold tracking-wide text-subtle lg:inline">ATOM Code</span>
        <span className="hidden text-[12px] text-line-strong lg:inline">/</span>
        <WorkspaceMenu />
      </div>

      <CommandCenter />

      <div className="no-drag ml-auto flex shrink-0 items-center gap-0.5">
        <LayoutToggles />
        <div className="mx-1 h-4 w-px bg-line" />
        <AccountButton />
      </div>
    </header>
  )
}

function WorkspaceMenu() {
  const workspace = useWorkspaceStore((s) => s.workspace)
  const recent = useSettingsStore((s) => s.settings.recentWorkspaces)
  const menu = useMenu('bottom-start')

  const entries: MenuEntry[] = [
    { id: 'open', label: 'Open Folder…', icon: <FolderOpen size={14} />, shortcut: 'mod+o', onSelect: () => void useWorkspaceStore.getState().openFolderDialog() },
    ...(recent.length ? ([{ type: 'separator', id: 's1' }, { type: 'header', id: 'h', label: 'Recent folders' }] as MenuEntry[]) : []),
    ...recent.slice(0, 10).map(
      (r): MenuEntry => ({
        id: `r:${r.path}`,
        label: r.name || basename(r.path),
        description: r.path,
        checked: workspace?.path === r.path,
        onSelect: () => workspace?.path !== r.path && void useWorkspaceStore.getState().openWorkspace(r.path)
      })
    ),
    ...(workspace
      ? ([
          { type: 'separator', id: 's2' },
          { id: 'close', label: 'Close Folder', icon: <FolderX size={14} />, onSelect: () => useWorkspaceStore.getState().closeWorkspace() }
        ] as MenuEntry[])
      : [])
  ]

  return (
    <>
      <button
        type="button"
        title={workspace ? `${workspace.path} — switch folder` : 'Open a folder'}
        onClick={menu.openFromEvent}
        className={cn(
          'no-drag flex min-w-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[12.5px] font-medium text-fg transition-colors hover:bg-hover',
          menu.open && 'bg-active'
        )}
      >
        <span className="truncate">{workspace?.name ?? 'No folder'}</span>
        <ChevronDown size={12} className="shrink-0 text-subtle" />
      </button>
      <Menu {...menu.props} entries={entries} minWidth={300} />
    </>
  )
}

function CommandCenter() {
  const workspace = useWorkspaceStore((s) => s.workspace)
  return (
    <div className="pointer-events-none absolute inset-x-0 flex justify-center">
      <button
        type="button"
        title={`Search files (${formatKeybinding('mod+p')}) · Commands (${formatKeybinding('mod+shift+p')})`}
        onClick={() => useLayoutStore.getState().openCommandPalette('')}
        className="no-drag pointer-events-auto flex h-[26px] w-[min(440px,36vw)] min-w-[180px] items-center gap-2 rounded-md border border-line bg-input/70 px-2.5 text-[12px] text-subtle transition-colors hover:border-line-strong hover:bg-hover hover:text-muted"
      >
        <Search size={13} className="shrink-0" />
        <span className="min-w-0 flex-1 truncate text-left">{workspace ? `Search ${workspace.name}: files, commands…` : 'Search files, commands…'}</span>
        <Kbd keys="mod+p" className="shrink-0" />
      </button>
    </div>
  )
}

function LayoutToggles() {
  const sidebarVisible = useLayoutStore((s) => s.sidebarVisible)
  const panelVisible = useLayoutStore((s) => s.panelVisible)
  const agentVisible = useLayoutStore((s) => s.agentVisible)
  const agentMaximized = useLayoutStore((s) => s.agentMaximized)
  const l = useLayoutStore.getState
  return (
    <>
      <IconButton
        title={`${sidebarVisible ? 'Hide' : 'Show'} Sidebar (${formatKeybinding('mod+b')})`}
        icon={<PanelLeft size={15} />}
        active={sidebarVisible}
        onClick={() => l().toggleSidebar()}
      />
      <IconButton
        title={`${panelVisible && !agentMaximized ? 'Hide' : 'Show'} Panel (${formatKeybinding('mod+j')})`}
        icon={<PanelBottom size={15} />}
        active={panelVisible && !agentMaximized}
        onClick={togglePanel}
      />
      <IconButton
        title={`${agentVisible ? 'Hide' : 'Show'} ATOM Agent (${formatKeybinding('mod+alt+b')})`}
        icon={<PanelRight size={15} />}
        active={agentVisible}
        onClick={() => l().toggleAgent()}
      />
      <IconButton
        title={agentMaximized ? 'Restore Editor Layout' : 'Agent Layout — maximize the agent'}
        icon={agentMaximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        active={agentMaximized}
        onClick={() => l().setAgentMaximized(!agentMaximized)}
      />
    </>
  )
}

function AccountButton() {
  const status = useAuthStore((s) => s.status)
  const title = status?.loggedIn
    ? `${status.email ?? 'Signed in'}${status.subscriptionType ? ` · ${status.subscriptionType}` : ''} — Account settings`
    : 'Sign in to Claude — Account settings'
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={() => useLayoutStore.getState().openSettings('account')}
      className="flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-hover"
    >
      <AccountAvatar size={20} />
    </button>
  )
}
