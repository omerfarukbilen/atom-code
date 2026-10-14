import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentType } from 'react'
import { ArrowUpRight, Cpu, FileCode, Info, Layers, Palette, Plug, Puzzle, ScrollText, Search, Settings2, ShieldCheck, SquareTerminal, User, X } from 'lucide-react'
import { IconButton, Input, Kbd } from '../ui'
import { useLayoutStore } from '../../stores/layout'
import { useAuthStore } from '../../stores/auth'
import { cn } from '../../lib/cn'
import { AccountAvatar } from '../auth/AccountCard'
import { SettingsQueryContext, matchesQuery } from './controls'
import { AccountSection } from './sections/AccountSection'
import { AgentSection } from './sections/AgentSection'
import { ModesSection } from './sections/ModesSection'
import { RulesSection } from './sections/RulesSection'
import { PermissionsSection } from './sections/PermissionsSection'
import { McpSection } from './sections/McpSection'
import { EditorSection, TerminalSection } from './sections/EditorSection'
import { AppearanceSection } from './sections/AppearanceSection'
import { AboutSection } from './sections/AboutSection'

export type SettingsSectionId = 'account' | 'agent' | 'modes' | 'rules' | 'permissions' | 'mcp' | 'skills' | 'editor' | 'terminal' | 'appearance' | 'about'

interface SectionDef {
  id: SettingsSectionId
  label: string
  icon: ComponentType<{ size?: number; className?: string }>
  group: string
  component?: ComponentType
  /** Extra words that make the whole section match a search. */
  keywords: string
}

const SECTIONS: SectionDef[] = [
  { id: 'account', label: 'Account', icon: User, group: 'Account', component: AccountSection, keywords: 'sign in login logout plan subscription api key token' },
  { id: 'agent', label: 'Models & Agent', icon: Cpu, group: 'Agent', component: AgentSection, keywords: 'model effort defaults agent claude code binary' },
  { id: 'modes', label: 'Modes', icon: Layers, group: 'Agent', component: ModesSection, keywords: 'modes custom agent plan ask debug review tdd' },
  { id: 'rules', label: 'Rules', icon: ScrollText, group: 'Agent', component: RulesSection, keywords: 'rules instructions atom.md claude.md' },
  { id: 'permissions', label: 'Permissions', icon: ShieldCheck, group: 'Agent', component: PermissionsSection, keywords: 'permissions allow deny tools rules' },
  { id: 'mcp', label: 'MCP Servers', icon: Plug, group: 'Agent', component: McpSection, keywords: 'mcp servers tools integrations' },
  { id: 'skills', label: 'Skills', icon: Puzzle, group: 'Agent', keywords: 'skills agents commands library' },
  { id: 'editor', label: 'Editor', icon: FileCode, group: 'Workbench', component: EditorSection, keywords: 'editor monaco font tabs save' },
  { id: 'terminal', label: 'Terminal', icon: SquareTerminal, group: 'Workbench', component: TerminalSection, keywords: 'terminal shell font' },
  { id: 'appearance', label: 'Appearance', icon: Palette, group: 'Workbench', component: AppearanceSection, keywords: 'appearance theme font size language' },
  { id: 'about', label: 'About', icon: Info, group: 'ATOM', component: AboutSection, keywords: 'about version reset' }
]

const GROUPS = ['Account', 'Agent', 'Workbench', 'ATOM']

const ALIASES: Record<string, SettingsSectionId> = {
  models: 'agent',
  model: 'agent',
  'models-agent': 'agent',
  general: 'agent',
  'mcp-servers': 'mcp',
  mcpServers: 'mcp',
  theme: 'appearance',
  auth: 'account',
  login: 'account'
}

function resolveSection(id: string): SettingsSectionId {
  if (SECTIONS.some((s) => s.id === id)) return id as SettingsSectionId
  return ALIASES[id] ?? 'account'
}

/** Full-page settings overlay (opened via useLayoutStore.openSettings). */
export function SettingsView() {
  const open = useLayoutStore((s) => s.settingsOpen)
  if (!open) return null
  return <SettingsPage />
}

function SettingsPage() {
  const rawSection = useLayoutStore((s) => s.settingsSection)
  const openSettings = useLayoutStore((s) => s.openSettings)
  const closeSettings = useLayoutStore((s) => s.closeSettings)
  const authStatus = useAuthStore((s) => s.status)
  const [query, setQuery] = useState('')
  const [counts, setCounts] = useState<Record<string, number>>({})
  const searchRef = useRef<HTMLInputElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const q = query.trim().toLowerCase()

  const section = resolveSection(rawSection)

  const openSkills = (): void => {
    // Never leave "skills" as the remembered section, or the next plain openSettings() would bounce.
    useLayoutStore.setState((st) => ({ settingsOpen: false, settingsSection: st.settingsSection === 'skills' ? 'account' : st.settingsSection }))
    const layout = useLayoutStore.getState()
    if (!(layout.sidebarVisible && layout.sidebarView === 'skills')) layout.showSidebarView('skills')
  }

  // "Skills" is a link to the sidebar view rather than a page.
  useEffect(() => {
    if (rawSection === 'skills') openSkills()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawSection])

  // Esc closes (dialogs and menus stop propagation of their own Esc presses).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.defaultPrevented) return
      // A dialog on top (login, confirm, mode editor…) owns the keyboard.
      if (document.querySelector('[role="dialog"][aria-modal="true"]') || useAuthStore.getState().loginOpen) return
      const mod = e.metaKey || e.ctrlKey
      if (e.key === 'Escape') {
        if (query && document.activeElement === searchRef.current) {
          setQuery('')
          return
        }
        e.preventDefault()
        closeSettings()
      } else if (mod && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        searchRef.current?.focus()
        searchRef.current?.select()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [closeSettings, query])

  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 })
  }, [section, q === ''])

  // Count matching rows per section while searching (rows mark themselves with data-setting-row).
  useLayoutEffect(() => {
    if (!q || !contentRef.current) {
      setCounts({})
      return
    }
    const next: Record<string, number> = {}
    contentRef.current.querySelectorAll<HTMLElement>('[data-section-id]').forEach((el) => {
      next[el.dataset.sectionId ?? ''] = el.querySelectorAll('[data-setting-row]').length
    })
    setCounts(next)
  }, [q])

  const searchable = useMemo(() => SECTIONS.filter((s) => s.component), [])
  const totalMatches = Object.values(counts).reduce((a, b) => a + b, 0)
  const active = SECTIONS.find((s) => s.id === section) ?? SECTIONS[0]
  const ActiveComponent = active.component ?? AccountSection

  return (
    <div className="fixed inset-x-0 bottom-0 top-[38px] z-[80] flex bg-app animate-fade-in" role="dialog" aria-label="Settings">
      {/* Navigation */}
      <aside className="flex w-[236px] shrink-0 flex-col border-r border-line bg-sidebar">
        <div className="flex items-center gap-2 px-4 pb-3 pt-4">
          <Settings2 size={15} className="text-muted" />
          <span className="text-[13px] font-semibold text-fg">Settings</span>
        </div>
        <div className="px-3 pb-2">
          <Input
            ref={searchRef}
            inputSize="sm"
            autoFocus
            icon={<Search size={13} />}
            placeholder="Search settings"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            right={
              query ? (
                <button type="button" title="Clear search" onClick={() => setQuery('')} className="text-subtle hover:text-fg">
                  <X size={12} />
                </button>
              ) : (
                <Kbd keys="mod+f" />
              )
            }
          />
        </div>
        <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {GROUPS.map((group) => (
            <div key={group} className="mt-2">
              <div className="px-2 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-wider text-subtle">{group}</div>
              {SECTIONS.filter((s) => s.group === group).map((s) => {
                const Icon = s.icon
                const isLink = !s.component
                const count = q ? counts[s.id] : undefined
                const dim = q && !isLink && !count
                const selected = !q && !isLink && s.id === section
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => {
                      if (isLink) {
                        openSkills()
                        return
                      }
                      setQuery('')
                      openSettings(s.id)
                    }}
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors duration-100',
                      selected ? 'bg-active text-fg' : 'text-muted hover:bg-hover hover:text-fg',
                      dim && 'opacity-40'
                    )}
                  >
                    <Icon size={15} className={cn('shrink-0', selected ? 'text-accent' : 'text-subtle')} />
                    <span className="min-w-0 flex-1 truncate">{s.label}</span>
                    {isLink && <ArrowUpRight size={12} className="text-subtle" />}
                    {count ? <span className="rounded bg-accent-soft px-1.5 text-[10.5px] font-medium text-accent">{count}</span> : null}
                  </button>
                )
              })}
            </div>
          ))}
        </nav>
        <button
          type="button"
          onClick={() => {
            setQuery('')
            openSettings('account')
          }}
          className="flex items-center gap-2.5 border-t border-line px-4 py-3 text-left hover:bg-hover"
        >
          <AccountAvatar status={authStatus} size={26} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12px] font-medium text-fg">{authStatus?.loggedIn ? (authStatus.email ?? 'Signed in') : 'Not signed in'}</span>
            <span className="block truncate text-[11px] text-subtle">{authStatus?.loggedIn ? 'Manage account' : 'Sign in with Claude'}</span>
          </span>
        </button>
      </aside>

      {/* Content */}
      <div className="relative min-w-0 flex-1">
        <div className="absolute right-4 top-3 z-10 flex items-center gap-2">
          <Kbd keys="escape" className="opacity-70" />
          <IconButton title="Close settings (Esc)" size="md" icon={<X size={16} />} onClick={closeSettings} />
        </div>
        <div ref={contentRef} className="h-full overflow-y-auto">
          <div className="mx-auto w-full max-w-[860px] px-10 pb-16 pt-8">
            {q ? (
              <>
                <div className="mb-6 text-[12.5px] text-muted">
                  {totalMatches > 0 ? (
                    <>
                      {totalMatches} {totalMatches === 1 ? 'setting matches' : 'settings match'} “<span className="text-fg">{query.trim()}</span>”
                    </>
                  ) : (
                    <>
                      No settings match “<span className="text-fg">{query.trim()}</span>”. Try another word, or browse the sections on the left.
                    </>
                  )}
                </div>
                {searchable.map((s) => {
                  const Component = s.component ?? AccountSection
                  const sectionMatches = matchesQuery(q, s.label, s.keywords)
                  return (
                    <section key={s.id} data-section-id={s.id} className="mb-10 [&:not(:has([data-setting-row]))]:hidden">
                      <SettingsQueryContext.Provider value={sectionMatches ? '' : q}>
                        <Component />
                      </SettingsQueryContext.Provider>
                    </section>
                  )
                })}
              </>
            ) : (
              <SettingsQueryContext.Provider value="">
                <div key={section} className="animate-fade-in">
                  <ActiveComponent />
                </div>
              </SettingsQueryContext.Provider>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
