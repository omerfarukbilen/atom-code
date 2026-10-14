import { useEffect, useState } from 'react'
import { Copy } from 'lucide-react'
import { atom } from '../../lib/api'
import { useAuthStore } from '../../stores/auth'
import { useLayoutStore } from '../../stores/layout'
import { toast } from '../../stores/toast'
import { AtomLogo, Button, Modal } from '../ui'

function uaVersion(name: string): string | null {
  const m = new RegExp(`${name}/([\\d.]+)`).exec(navigator.userAgent)
  return m ? m[1] : null
}

const PLATFORM_NAMES: Record<string, string> = { darwin: 'macOS', win32: 'Windows', linux: 'Linux' }

export function AboutDialog() {
  const open = useLayoutStore((s) => s.aboutOpen)
  const setOpen = useLayoutStore((s) => s.setAboutOpen)
  const status = useAuthStore((s) => s.status)
  const [version, setVersion] = useState<string>('')

  useEffect(() => {
    if (!open || version) return
    atom.app
      .getVersion()
      .then(setVersion)
      .catch(() => setVersion('dev'))
  }, [open, version])

  const rows: [string, string][] = [
    ['Version', version || '…'],
    ['Claude Code', status?.claudeVersion ?? (status?.claudeBinary ? 'detected' : 'not found')],
    ['Electron', uaVersion('Electron') ?? '—'],
    ['Chromium', uaVersion('Chrome') ?? '—'],
    ['Platform', PLATFORM_NAMES[atom.platform] ?? atom.platform]
  ]

  const copyInfo = (): void => {
    const text = ['ATOM Code', ...rows.map(([k, v]) => `${k}: ${v}`)].join('\n')
    void navigator.clipboard.writeText(text).then(
      () => toast.success('Version info copied'),
      () => toast.error('Clipboard unavailable')
    )
  }

  return (
    <Modal
      open={open}
      onClose={() => setOpen(false)}
      width="max-w-sm"
      hideClose
      footer={
        <>
          <Button size="sm" variant="ghost" icon={<Copy size={13} />} onClick={copyInfo}>
            Copy
          </Button>
          <Button size="sm" variant="primary" onClick={() => setOpen(false)}>
            Close
          </Button>
        </>
      }
    >
      <div className="flex flex-col items-center px-6 pb-5 pt-7 text-center">
        <div className="relative mb-3">
          <div className="absolute inset-0 rounded-full bg-accent-soft blur-xl" />
          <AtomLogo size={72} animated className="relative" />
        </div>
        <div className="atom-gradient-text text-[22px] font-bold tracking-tight">ATOM Code</div>
        <div className="mt-1 text-[12.5px] text-muted">The AI-native code editor, powered by Claude.</div>

        <dl className="mt-5 grid w-full grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-lg border border-line bg-panel px-4 py-3 text-left text-[12px] selectable">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-subtle">{k}</dt>
              <dd className="truncate font-mono text-[11.5px] text-fg">{v}</dd>
            </div>
          ))}
        </dl>

        <p className="mt-4 text-[11.5px] leading-relaxed text-subtle">
          Created by Ömer Faruk Bilen. Built on the Claude Agent SDK, Electron, React, Monaco and xterm.js.
          <br />
          Claude is a trademark of Anthropic, PBC.
        </p>
      </div>
    </Modal>
  )
}
