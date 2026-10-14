import { useEffect, useState } from 'react'
import { BookOpen, ExternalLink, FolderOpen, RotateCcw } from 'lucide-react'
import { AtomLogo, Button, confirmDialog } from '../../ui'
import { useSettingsStore } from '../../../stores/settings'
import { useAuthStore } from '../../../stores/auth'
import { errorMessage, toast } from '../../../stores/toast'
import { atom } from '../../../lib/api'
import { Searchable, SectionHeader, SettingGroup, SettingRow } from '../controls'

const LINKS = [
  { label: 'Claude Code documentation', url: 'https://docs.claude.com/en/docs/claude-code/overview' },
  { label: 'Claude Agent SDK', url: 'https://docs.claude.com/en/api/agent-sdk/overview' },
  { label: 'Usage & limits', url: 'https://claude.ai/settings/usage' },
  { label: 'Anthropic Console', url: 'https://console.anthropic.com' },
  { label: 'Model Context Protocol', url: 'https://modelcontextprotocol.io' }
]

function uaVersion(name: string): string | null {
  const m = new RegExp(`${name}/([\\d.]+)`).exec(navigator.userAgent)
  return m ? m[1] : null
}

export function AboutSection() {
  const reset = useSettingsStore((s) => s.reset)
  const status = useAuthStore((s) => s.status)
  const [version, setVersion] = useState<string | null>(null)

  useEffect(() => {
    atom.app
      .getVersion()
      .then(setVersion)
      .catch(() => setVersion(null))
  }, [])

  const versions: [string, string | null | undefined][] = [
    ['ATOM Code', version],
    ['Claude Code', status?.claudeVersion?.replace(/^v/, '')],
    ['Electron', uaVersion('Electron')],
    ['Chromium', uaVersion('Chrome')],
    ['Platform', atom.platform]
  ]

  const resetAll = async (): Promise<void> => {
    const ok = await confirmDialog({
      title: 'Reset all settings?',
      message: 'Themes, editor preferences, agent defaults, custom modes, rules and MCP servers go back to their defaults. Your sign-in, stored credentials and files are not affected.',
      confirmLabel: 'Reset settings',
      danger: true
    })
    if (!ok) return
    try {
      await reset()
      toast.success('Settings reset to defaults')
    } catch (err) {
      toast.error('Could not reset settings', errorMessage(err))
    }
  }

  const openSettingsFolder = async (): Promise<void> => {
    try {
      const paths = await atom.app.getPaths()
      await atom.app.showItemInFolder(paths.userData)
    } catch (err) {
      toast.error('Could not open folder', errorMessage(err))
    }
  }

  return (
    <div>
      <SectionHeader title="About" />

      <SettingGroup flush>
        <Searchable terms="about version atom code claude electron">
          <div className="relative mb-6 overflow-hidden rounded-xl border border-line bg-elevated px-6 py-6">
            <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-accent-soft blur-3xl" />
            <div className="relative flex items-center gap-5">
              <AtomLogo size={64} animated />
              <div className="min-w-0 flex-1">
                <div className="atom-gradient-text text-[24px] font-bold tracking-tight">ATOM Code</div>
                <div className="mt-0.5 text-[12.5px] text-muted">An AI-native code editor with a Claude-powered agent harness.</div>
                <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1">
                  {versions.map(([k, v]) => (
                    <div key={k} className="text-[11.5px]">
                      <span className="text-subtle">{k} </span>
                      <span className="selectable font-mono text-fg">{v ?? '—'}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </Searchable>
      </SettingGroup>

      <SettingGroup title="Resources" flush>
        <Searchable terms="links documentation docs help resources">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {LINKS.map((l) => (
              <button
                key={l.url}
                type="button"
                onClick={() => void atom.app.openExternal(l.url)}
                className="flex items-center gap-2.5 rounded-lg border border-line bg-elevated px-3 py-2.5 text-left text-[12.5px] text-fg transition-colors hover:border-line-strong hover:bg-overlay"
              >
                <BookOpen size={14} className="text-subtle" />
                <span className="min-w-0 flex-1 truncate">{l.label}</span>
                <ExternalLink size={12} className="text-subtle" />
              </button>
            ))}
          </div>
        </Searchable>
      </SettingGroup>

      <SettingGroup title="Maintenance">
        <SettingRow label="Settings folder" keywords="settings file json user data folder" description="Where ATOM keeps its settings and stored credentials.">
          <Button size="sm" variant="secondary" icon={<FolderOpen size={13} />} onClick={() => void openSettingsFolder()}>
            Reveal
          </Button>
        </SettingRow>
        <SettingRow label="Reset all settings" keywords="reset defaults restore factory" description="Restore every setting to its default value." danger>
          <Button size="sm" variant="danger" icon={<RotateCcw size={13} />} onClick={() => void resetAll()}>
            Reset…
          </Button>
        </SettingRow>
      </SettingGroup>

      <p className="text-center text-[11px] text-subtle">Made with care by Ömer Faruk Bilen · MIT License · Powered by Claude</p>
    </div>
  )
}
