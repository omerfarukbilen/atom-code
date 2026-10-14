import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { Check, ClipboardPaste, CornerDownLeft, ExternalLink, Globe, KeyRound, RotateCcw, ShieldCheck, TerminalSquare, XCircle } from 'lucide-react'
import type { LoginExitEvent, LoginMode, LoginOutputEvent } from '@shared/types'
import { Badge, Button, Input, Modal, Spinner } from '../ui'
import { useAuthStore, planLabel } from '../../stores/auth'
import { useSettingsStore } from '../../stores/settings'
import { errorMessage, toast } from '../../stores/toast'
import { atom } from '../../lib/api'
import { cn } from '../../lib/cn'
import { isMac } from '../../lib/platform'
import { buildXtermTheme, readThemeColors, withBundledFonts } from '../../lib/xterm-theme'

type Phase = 'starting' | 'waiting' | 'code' | 'verifying' | 'success' | 'failed'

const COPY: Record<LoginMode, { title: string; description: ReactNode; icon: ReactNode }> = {
  claudeai: {
    title: 'Sign in with Claude',
    icon: <ShieldCheck size={16} />,
    description: 'ATOM Code uses the official Claude Code sign-in. A browser window opens — approve access, then paste the code here if asked.'
  },
  console: {
    title: 'Sign in with Anthropic Console',
    icon: <Globe size={16} />,
    description:
      'ATOM Code uses the official Claude Code sign-in. A browser window opens — approve access with your Console account (usage is billed to your API credits), then paste the code here if asked.'
  },
  'setup-token': {
    title: 'Create a long-lived token',
    icon: <KeyRound size={16} />,
    description:
      'Runs the official `claude setup-token` flow. Approve access in the browser; ATOM Code captures the token and saves it for every agent session. Requires a Claude subscription.'
  }
}

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?|\x1b[()][A-Za-z0-9]/g
// eslint-disable-next-line no-control-regex
/** Only complete URLs (followed by a terminator) so a URL split across output chunks is not captured half-way. */
const URL_RE = /https:\/\/[^\s\x07\x1b"'<>`]+(?=[\s\x07\x1b"'<>`])/g
const AUTH_HOST_RE = /^https:\/\/([a-z0-9-]+\.)*(claude\.ai|claude\.com|anthropic\.com)\//i
const CODE_PROMPT_RE = /paste\s+(the\s+|your\s+)?(code|authori[sz]ation)|enter\s+(the\s+|your\s+)?(authori[sz]ation\s+)?code|authori[sz]ation\s+code/i

/** Login dialog with an embedded terminal running the official Claude Code login flow. */
export function LoginDialog() {
  const open = useAuthStore((s) => s.loginOpen)
  const mode = useAuthStore((s) => s.loginMode)
  if (!open) return null
  return <LoginDialogInner mode={mode} />
}

function LoginDialogInner({ mode }: { mode: LoginMode }) {
  const closeLogin = useAuthStore((s) => s.closeLogin)
  const themeId = useSettingsStore((s) => s.settings.theme)
  const termFont = useSettingsStore((s) => s.settings.terminal.fontFamily)

  const [attempt, setAttempt] = useState(0)
  const [phase, setPhase] = useState<Phase>('starting')
  const [error, setError] = useState<string | null>(null)
  const [authUrl, setAuthUrl] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [tokenMissing, setTokenMissing] = useState(false)
  const [manualToken, setManualToken] = useState('')
  const [savingToken, setSavingToken] = useState(false)

  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const loginIdRef = useRef<string | null>(null)
  const finishedRef = useRef(false)
  const phaseRef = useRef<Phase>('starting')
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [failedStep, setFailedStep] = useState(0)

  const updatePhase = useCallback((p: Phase) => {
    if (p === 'failed') setFailedStep(stepOf(phaseRef.current))
    phaseRef.current = p
    setPhase(p)
  }, [])

  // ── Terminal (one per dialog; reset on retry) ────────────────────────────
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const colors = readThemeColors(themeId)
    const term = new Terminal({
      convertEol: true,
      cursorBlink: true,
      fontFamily: withBundledFonts(termFont),
      fontSize: 12,
      lineHeight: 1.25,
      scrollback: 2000,
      theme: { ...buildXtermTheme(themeId), background: colors.input, cursorAccent: colors.input, overviewRulerBorder: colors.input }
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(el)
    termRef.current = term
    fitRef.current = fit

    // Let the browser handle paste/copy shortcuts (xterm would otherwise send ^V / ^C).
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true
      const mod = isMac ? e.metaKey : e.ctrlKey
      const key = e.key.toLowerCase()
      if (mod && key === 'v') return false
      if (mod && key === 'c' && term.hasSelection()) {
        void navigator.clipboard.writeText(term.getSelection())
        return false
      }
      return true
    })
    const dataSub = term.onData((data) => {
      const id = loginIdRef.current
      if (id && !finishedRef.current) void atom.auth.writeLogin(id, data).catch(() => undefined)
    })

    const doFit = (): void => {
      try {
        fit.fit()
      } catch {
        /* container not measurable yet */
      }
    }
    const ro = new ResizeObserver(doFit)
    ro.observe(el)
    requestAnimationFrame(() => {
      doFit()
      term.focus()
    })

    return () => {
      ro.disconnect()
      dataSub.dispose()
      term.dispose()
      termRef.current = null
      fitRef.current = null
    }
    // Theme / font changes are applied below without recreating the terminal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const term = termRef.current
    if (!term) return
    const colors = readThemeColors(themeId)
    term.options.theme = { ...buildXtermTheme(themeId), background: colors.input, cursorAccent: colors.input, overviewRulerBorder: colors.input }
    term.options.fontFamily = withBundledFonts(termFont)
  }, [themeId, termFont])

  // ── Login process ─────────────────────────────────────────────────────────
  useEffect(() => {
    let disposed = false
    let currentId: string | null = null
    let transcript = ''
    const early: LoginOutputEvent[] = []
    const earlyExits: LoginExitEvent[] = []

    finishedRef.current = false
    loginIdRef.current = null
    setError(null)
    setAuthUrl(null)
    setTokenMissing(false)
    updatePhase('starting')
    const term = termRef.current
    if (term) {
      term.reset()
      term.write(`\x1b[2m$ ${mode === 'setup-token' ? 'claude setup-token' : `claude auth login --${mode}`}\x1b[0m\r\n`)
    }

    const handleOutput = (data: string): void => {
      termRef.current?.write(data)
      transcript = (transcript + data).slice(-20000)
      const plain = transcript.replace(ANSI_RE, '')
      const candidates: string[] = [...(plain.match(URL_RE) ?? []), ...(transcript.match(URL_RE) ?? [])]
      const url = candidates.find((u) => AUTH_HOST_RE.test(u))
      if (url) setAuthUrl(url)
      if (phaseRef.current === 'waiting' && CODE_PROMPT_RE.test(plain.slice(-600))) updatePhase('code')
    }

    const handleExit = async (e: LoginExitEvent): Promise<void> => {
      finishedRef.current = true
      if (disposed) return
      if (!e.success) {
        setError(e.exitCode === null ? 'The sign-in process was terminated.' : `The sign-in process exited with code ${e.exitCode}.`)
        updatePhase('failed')
        return
      }
      updatePhase('verifying')
      await useAuthStore.getState().refresh(true)
      if (disposed) return
      const status = useAuthStore.getState().status

      if (mode === 'setup-token') {
        if (!e.tokenCaptured) {
          // The CLI printed the token but we could not detect it — let the user paste it.
          setTokenMissing(true)
          updatePhase('success')
          return
        }
        updatePhase('success')
        toast.success('Long-lived token saved', 'ATOM Code will use it for all agent sessions.')
        closeTimer.current = setTimeout(() => useAuthStore.getState().closeLogin(), 1600)
        return
      }

      if (!status?.loggedIn) {
        setError(status?.error ?? 'The login finished, but Claude Code still reports that you are signed out.')
        updatePhase('failed')
        return
      }
      updatePhase('success')
      const who = status.email ?? status.organization ?? 'your Claude account'
      const plan = planLabel(status)
      toast.success(`Signed in as ${who}`, plan ? `${plan} plan · Claude Code is ready.` : 'Claude Code is ready.')
      closeTimer.current = setTimeout(() => useAuthStore.getState().closeLogin(), 1600)
    }

    const offOut = atom.auth.onLoginOutput((e) => {
      if (disposed) return
      if (currentId === null) early.push(e)
      else if (e.loginId === currentId) handleOutput(e.data)
    })
    const offExit = atom.auth.onLoginExit((e) => {
      if (disposed) return
      if (currentId === null) earlyExits.push(e)
      else if (e.loginId === currentId) void handleExit(e)
    })

    atom.auth
      .startLogin(mode)
      .then(({ loginId }) => {
        if (disposed) {
          void atom.auth.cancelLogin(loginId).catch(() => undefined)
          return
        }
        currentId = loginId
        loginIdRef.current = loginId
        updatePhase('waiting')
        for (const e of early) if (e.loginId === loginId) handleOutput(e.data)
        const exit = earlyExits.find((e) => e.loginId === loginId)
        if (exit) void handleExit(exit)
        termRef.current?.focus()
      })
      .catch((err: unknown) => {
        if (disposed) return
        finishedRef.current = true
        setError(errorMessage(err))
        updatePhase('failed')
      })

    return () => {
      disposed = true
      offOut()
      offExit()
      if (closeTimer.current) clearTimeout(closeTimer.current)
      if (currentId && !finishedRef.current) void atom.auth.cancelLogin(currentId).catch(() => undefined)
    }
  }, [mode, attempt, updatePhase])

  const active = phase === 'starting' || phase === 'waiting' || phase === 'code'

  const cancelRef = useRef<() => void>(() => undefined)
  cancelRef.current = () => {
    const id = loginIdRef.current
    if (id && !finishedRef.current) {
      finishedRef.current = true
      void atom.auth.cancelLogin(id).catch(() => undefined)
    }
    closeLogin()
  }
  // Stable identity: Modal re-runs its focus effect whenever onClose changes.
  const onClose = useCallback(() => cancelRef.current(), [])

  const submitCode = (): void => {
    const id = loginIdRef.current
    const value = code.trim()
    if (!id || !value) return
    void atom.auth.writeLogin(id, `${value}\r`).catch((err: unknown) => toast.error('Could not send the code', errorMessage(err)))
    setCode('')
    termRef.current?.focus()
  }

  const saveManualToken = async (): Promise<void> => {
    const token = manualToken.trim()
    if (!token) return
    setSavingToken(true)
    try {
      await atom.auth.setOAuthToken(token)
      await useAuthStore.getState().refresh(true)
      toast.success('Long-lived token saved', 'ATOM Code will use it for all agent sessions.')
      closeLogin()
    } catch (err) {
      toast.error('Could not save the token', errorMessage(err))
    } finally {
      setSavingToken(false)
    }
  }

  const copy = COPY[mode]
  const status = useAuthStore((s) => s.status)

  return (
    <Modal
      open
      onClose={onClose}
      width="max-w-[640px]"
      dismissible={!active}
      title={
        <span className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-accent-soft text-accent">{copy.icon}</span>
          {copy.title}
        </span>
      }
      description={copy.description}
      footer={
        <>
          <div className="mr-auto min-w-0 text-[11.5px] text-muted">
            {authUrl && active ? (
              <button
                type="button"
                className="inline-flex items-center gap-1 text-accent hover:underline"
                onClick={() => void atom.app.openExternal(authUrl)}
                title={authUrl}
              >
                <ExternalLink size={12} />
                Browser didn’t open? Open the sign-in page manually
              </button>
            ) : active ? (
              <span>Browser didn’t open? Copy the link from the terminal and open it manually.</span>
            ) : null}
          </div>
          {phase === 'failed' && (
            <Button variant="primary" size="sm" icon={<RotateCcw size={13} />} onClick={() => setAttempt((a) => a + 1)}>
              Retry
            </Button>
          )}
          {phase === 'success' && !tokenMissing ? (
            <Button variant="primary" size="sm" onClick={() => closeLogin()}>
              Done
            </Button>
          ) : (
            <Button variant="ghost" size="sm" onClick={onClose}>
              {active || phase === 'verifying' ? 'Cancel' : 'Close'}
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-3 px-5 py-4">
        <Stepper phase={phase} mode={mode} failedStep={failedStep} />

        <div className="relative overflow-hidden rounded-lg border border-line bg-input">
          <div className="flex items-center gap-2 border-b border-line px-3 py-1.5 text-[11px] text-subtle">
            <TerminalSquare size={12} />
            <span className="font-mono">claude</span>
            <span className="ml-auto">{active ? 'Click to type · paste with ' + (isMac ? '⌘V' : 'Ctrl+V') : 'Session ended'}</span>
          </div>
          <div ref={containerRef} className="h-[240px] w-full" onClick={() => termRef.current?.focus()} />
          {phase === 'success' && <SuccessOverlay mode={mode} tokenMissing={tokenMissing} email={status?.email ?? status?.organization} plan={planLabel(status)} />}
        </div>

        {(phase === 'waiting' || phase === 'code') && (
          <div className={cn('flex items-center gap-2 rounded-lg border px-3 py-2 transition-colors', phase === 'code' ? 'border-accent bg-accent-soft' : 'border-line bg-panel')}>
            <ClipboardPaste size={14} className={phase === 'code' ? 'text-accent' : 'text-subtle'} />
            <Input
              inputSize="sm"
              className="flex-1"
              placeholder="Paste the authorization code from the browser"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  submitCode()
                }
              }}
            />
            <Button size="sm" variant={phase === 'code' ? 'primary' : 'secondary'} disabled={!code.trim()} onClick={submitCode} iconRight={<CornerDownLeft size={12} />}>
              Submit
            </Button>
          </div>
        )}

        {phase === 'failed' && error && (
          <div className="flex items-start gap-2 rounded-lg border border-line bg-danger-soft px-3 py-2.5 text-[12.5px] text-danger">
            <XCircle size={15} className="mt-0.5 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="font-medium">Sign-in did not complete</div>
              <div className="selectable mt-0.5 text-[12px] opacity-90">{error}</div>
            </div>
          </div>
        )}

        {tokenMissing && (
          <div className="flex flex-col gap-2 rounded-lg border border-line bg-warning-soft px-3 py-2.5">
            <div className="text-[12.5px] text-warning">The token was created but ATOM could not read it automatically. Copy it from the terminal above and paste it here.</div>
            <div className="flex gap-2">
              <Input
                inputSize="sm"
                type="password"
                className="flex-1"
                placeholder="sk-ant-oat…"
                value={manualToken}
                onChange={(e) => setManualToken(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void saveManualToken()}
              />
              <Button size="sm" variant="primary" loading={savingToken} disabled={!manualToken.trim()} onClick={() => void saveManualToken()}>
                Save token
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}

function stepOf(phase: Phase): number {
  return phase === 'starting' || phase === 'failed' ? 0 : phase === 'waiting' || phase === 'code' ? 1 : 2
}

function Stepper({ phase, mode, failedStep }: { phase: Phase; mode: LoginMode; failedStep: number }) {
  const failed = phase === 'failed'
  const step = failed ? failedStep : stepOf(phase)
  const steps = [
    { label: 'Start Claude Code', detail: phase === 'starting' ? 'Launching the official login…' : 'Login started' },
    {
      label: 'Approve in browser',
      detail: phase === 'code' ? 'Paste the code from the browser' : step === 1 ? 'Waiting for you to approve access…' : step > 1 ? 'Approved' : 'A browser window opens'
    },
    {
      label: mode === 'setup-token' ? 'Token saved' : 'Signed in',
      detail: phase === 'verifying' ? 'Verifying…' : phase === 'success' ? 'All set' : 'ATOM is ready to work'
    }
  ]
  return (
    <div className="grid grid-cols-3 gap-2">
      {steps.map((s, i) => {
        const done = !failed && (i < step || phase === 'success')
        const current = !failed && i === step && phase !== 'success'
        return (
          <div
            key={s.label}
            className={cn(
              'flex items-start gap-2 rounded-lg border px-2.5 py-2 transition-colors',
              current ? 'border-accent bg-accent-soft' : done ? 'border-line bg-panel' : 'border-line bg-transparent',
              failed && i === step && 'border-danger bg-danger-soft'
            )}
          >
            <span
              className={cn(
                'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold',
                done ? 'bg-success text-app' : current ? 'text-accent' : failed && i === step ? 'bg-danger text-app' : 'bg-active text-muted'
              )}
            >
              {done ? <Check size={11} strokeWidth={3} /> : current ? <Spinner size={13} /> : failed && i === step ? '!' : i + 1}
            </span>
            <span className="min-w-0">
              <span className={cn('block truncate text-[12px] font-medium', current || done ? 'text-fg' : 'text-muted')}>{s.label}</span>
              <span className={cn('block truncate text-[11px]', current ? 'animate-shimmer-text' : 'text-subtle')}>{failed && i === step ? 'Failed' : s.detail}</span>
            </span>
          </div>
        )
      })}
    </div>
  )
}

function SuccessOverlay({ mode, tokenMissing, email, plan }: { mode: LoginMode; tokenMissing: boolean; email?: string; plan: string | null }) {
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const raf = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(raf)
  }, [])
  if (tokenMissing) return null
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-elevated/95 backdrop-blur-sm animate-fade-in">
      <div className="relative flex h-14 w-14 items-center justify-center">
        <span className="absolute inset-0 animate-ping rounded-full bg-success-soft" style={{ animationIterationCount: 2 }} />
        <span
          className={cn(
            'relative flex h-14 w-14 items-center justify-center rounded-full bg-success text-app shadow-glow transition-transform duration-300 ease-out',
            shown ? 'scale-100' : 'scale-50'
          )}
        >
          <Check size={28} strokeWidth={3} />
        </span>
      </div>
      <div className="text-center">
        <div className="text-[15px] font-semibold text-fg">{mode === 'setup-token' ? 'Token saved' : 'You’re signed in'}</div>
        <div className="mt-1 flex items-center justify-center gap-2 text-[12.5px] text-muted">
          {mode === 'setup-token' ? <span>ATOM will use it for every agent session.</span> : <span className="selectable">{email ?? 'Claude account connected'}</span>}
          {plan && mode !== 'setup-token' && <Badge tone="accent">{plan}</Badge>}
        </div>
      </div>
    </div>
  )
}
