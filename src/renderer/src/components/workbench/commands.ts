import type { ThemeId } from '@shared/types'
import { registerCommands, type Command } from '../../stores/commands'
import { useEditorStore } from '../../stores/editor'
import { useGitStore } from '../../stores/git'
import { useLayoutStore, type SidebarView } from '../../stores/layout'
import { useSettingsStore } from '../../stores/settings'
import { useWorkspaceStore } from '../../stores/workspace'
import { startNewFile } from '../explorer/explorerActions'
import { useExplorerStore } from '../explorer/explorerStore'
import { useSearchStore } from '../search/searchStore'

/**
 * Core workbench commands (palette entries, keybindings and native-menu targets). The editor area registers
 * its own `file.*` editor commands and the agent panel its `agent.*` commands.
 */

const layout = () => useLayoutStore.getState()
const hasWorkspace = (): boolean => !!useWorkspaceStore.getState().workspace
const isRepo = (): boolean => !!useGitStore.getState().status?.isRepo

/** Show a sidebar view (never toggles it closed, unlike clicking the activity bar). */
export function revealSidebarView(view: SidebarView): void {
  useLayoutStore.setState({ sidebarVisible: true, sidebarView: view })
  if (layout().agentMaximized) layout().setAgentMaximized(false)
}

/** Toggle the bottom panel. In the agent layout the editor column (and the panel in it) is hidden, so showing
 * the panel leaves the agent layout instead of toggling an invisible panel. */
export function togglePanel(): void {
  const l = layout()
  if (l.agentMaximized) {
    l.setAgentMaximized(false)
    l.setPanelVisible(true)
    return
  }
  l.togglePanel()
}

function focusSearch(): void {
  revealSidebarView('search')
  // Seed the query with a single-line editor selection, like VS Code.
  const sel = useEditorStore.getState().getActiveEditorInfo()?.selection?.text
  const seed = sel && !sel.includes('\n') && sel.length <= 200 ? sel : undefined
  useSearchStore.getState().requestFocus(seed)
}

function setTheme(theme: ThemeId): void {
  void useSettingsStore.getState().update({ theme })
}

export function registerWorkbenchCommands(): () => void {
  const commands: Command[] = [
    // ── Navigation ──────────────────────────────────────────────────────────
    { id: 'workbench.quickOpen', title: 'Go to File…', category: 'File', keybinding: 'mod+p', icon: 'FileSearch', run: () => layout().openCommandPalette('') },
    {
      id: 'workbench.commandPalette',
      title: 'Show All Commands',
      category: 'View',
      keybinding: 'mod+shift+p',
      icon: 'Command',
      run: () => layout().openCommandPalette('>')
    },

    // ── Layout ──────────────────────────────────────────────────────────────
    { id: 'view.toggleSidebar', title: 'Toggle Primary Sidebar', category: 'View', keybinding: 'mod+b', icon: 'PanelLeft', run: () => layout().toggleSidebar() },
    { id: 'view.togglePanel', title: 'Toggle Panel', category: 'View', keybinding: 'mod+j', icon: 'PanelBottom', run: togglePanel },
    { id: 'view.toggleAgent', title: 'Toggle ATOM Agent Panel', category: 'View', keybinding: 'mod+alt+b', icon: 'PanelRight', run: () => layout().toggleAgent() },
    {
      id: 'view.toggleAgentMaximized',
      title: 'Toggle Agent Layout (Maximize Agent)',
      category: 'View',
      icon: 'Maximize2',
      // The palette lists the agent's own "Agent: Toggle Maximized Agent"; keep this id for menus/bindings only.
      hidden: true,
      run: () => layout().setAgentMaximized(!layout().agentMaximized)
    },
    { id: 'view.explorer', title: 'Show Explorer', category: 'View', keybinding: 'mod+shift+e', icon: 'Files', run: () => revealSidebarView('explorer') },
    { id: 'view.search', title: 'Search in Files', category: 'Search', keybinding: 'mod+shift+f', icon: 'Search', run: focusSearch },
    { id: 'view.git', title: 'Show Source Control', category: 'View', keybinding: 'mod+shift+g', icon: 'GitBranch', run: () => revealSidebarView('git') },
    // Hidden: the palette lists the agent's "Agent: Show Chat History" for the same view.
    { id: 'view.history', title: 'Show Agent History', category: 'View', icon: 'History', hidden: true, run: () => revealSidebarView('history') },
    { id: 'view.skills', title: 'Show Skills, Agents & Commands', category: 'View', icon: 'Sparkles', run: () => revealSidebarView('skills') },
    { id: 'view.settings', title: 'Open Settings', category: 'Preferences', keybinding: 'mod+,', icon: 'Settings', run: () => layout().openSettings() },
    { id: 'view.account', title: 'Account & Subscription', category: 'Preferences', icon: 'CircleUser', run: () => layout().openSettings('account') },

    // ── Workspace ───────────────────────────────────────────────────────────
    { id: 'file.openFolder', title: 'Open Folder…', category: 'File', keybinding: 'mod+o', icon: 'FolderOpen', run: () => useWorkspaceStore.getState().openFolderDialog() },
    { id: 'workspace.close', title: 'Close Folder', category: 'File', icon: 'FolderX', when: hasWorkspace, run: () => useWorkspaceStore.getState().closeWorkspace() },
    { id: 'workspace.refreshFiles', title: 'Rebuild File Index', category: 'File', icon: 'RefreshCw', when: hasWorkspace, run: () => useWorkspaceStore.getState().refreshFiles() },

    // ── Explorer ────────────────────────────────────────────────────────────
    { id: 'explorer.newFile', title: 'New File…', category: 'Explorer', icon: 'FilePlus', when: hasWorkspace, run: () => startNewFile('new-file') },
    { id: 'explorer.newFolder', title: 'New Folder…', category: 'Explorer', icon: 'FolderPlus', when: hasWorkspace, run: () => startNewFile('new-folder') },
    { id: 'explorer.collapseAll', title: 'Collapse Folders', category: 'Explorer', icon: 'ChevronsDownUp', when: hasWorkspace, run: () => useExplorerStore.getState().collapseAll() },
    { id: 'explorer.refresh', title: 'Refresh Explorer', category: 'Explorer', icon: 'RefreshCw', when: hasWorkspace, run: () => useExplorerStore.getState().refreshAll() },

    // ── Source control ──────────────────────────────────────────────────────
    { id: 'git.refresh', title: 'Refresh', category: 'Git', icon: 'RefreshCw', when: hasWorkspace, run: () => useGitStore.getState().refresh() },
    {
      id: 'git.commit',
      title: 'Commit',
      category: 'Git',
      icon: 'Check',
      when: isRepo,
      run: async () => {
        if (!useGitStore.getState().commitMessage.trim()) {
          revealSidebarView('git')
          return
        }
        await useGitStore.getState().commit()
      }
    },
    { id: 'git.commitAll', title: 'Commit All', category: 'Git', icon: 'CheckCheck', when: isRepo, run: () => void useGitStore.getState().commit({ all: true }) },
    {
      id: 'git.generateCommitMessage',
      title: 'Generate Commit Message with ATOM',
      category: 'Git',
      icon: 'Sparkles',
      when: isRepo,
      run: () => {
        revealSidebarView('git')
        return useGitStore.getState().generateMessage()
      }
    },
    { id: 'git.stageAll', title: 'Stage All Changes', category: 'Git', icon: 'Plus', when: isRepo, run: () => useGitStore.getState().stageAll() },
    { id: 'git.unstageAll', title: 'Unstage All Changes', category: 'Git', icon: 'Minus', when: isRepo, run: () => useGitStore.getState().unstageAll() },
    { id: 'git.pull', title: 'Pull', category: 'Git', icon: 'ArrowDown', when: isRepo, run: () => useGitStore.getState().pull() },
    { id: 'git.push', title: 'Push', category: 'Git', icon: 'ArrowUp', when: isRepo, run: () => useGitStore.getState().push() },
    {
      id: 'git.init',
      title: 'Initialize Repository',
      category: 'Git',
      icon: 'GitBranchPlus',
      when: () => hasWorkspace() && useGitStore.getState().status?.isRepo === false,
      run: () => useGitStore.getState().init()
    },

    // ── Appearance ──────────────────────────────────────────────────────────
    { id: 'theme.dark', title: 'Color Theme: ATOM Dark', category: 'Preferences', icon: 'Moon', run: () => setTheme('atom-dark') },
    { id: 'theme.midnight', title: 'Color Theme: ATOM Midnight', category: 'Preferences', icon: 'MoonStar', run: () => setTheme('atom-midnight') },
    { id: 'theme.light', title: 'Color Theme: ATOM Light', category: 'Preferences', icon: 'Sun', run: () => setTheme('atom-light') },
    {
      id: 'view.zoomInUi',
      title: 'Increase UI Font Size',
      category: 'View',
      icon: 'AArrowUp',
      run: () => void useSettingsStore.getState().update({ uiFontSize: Math.min(18, useSettingsStore.getState().settings.uiFontSize + 1) })
    },
    {
      id: 'view.zoomOutUi',
      title: 'Decrease UI Font Size',
      category: 'View',
      icon: 'AArrowDown',
      run: () => void useSettingsStore.getState().update({ uiFontSize: Math.max(11, useSettingsStore.getState().settings.uiFontSize - 1) })
    },

    // ── Help ────────────────────────────────────────────────────────────────
    { id: 'help.about', title: 'About ATOM Code', category: 'Help', icon: 'Info', run: () => layout().setAboutOpen(true) },

    // ── Native menu aliases (MenuCommand ids) ───────────────────────────────
    { id: 'view.commandPalette', title: 'Show All Commands', hidden: true, run: () => layout().openCommandPalette('>') },
    { id: 'view.quickOpen', title: 'Go to File…', hidden: true, run: () => layout().openCommandPalette('') }
  ]
  return registerCommands(commands)
}
