import { useState, type ReactNode } from 'react'
import type { AuthStatus } from '@shared/types'
import { AlertTriangle, ChevronDown, Eye, EyeOff, Globe, KeyRound, Lock, RefreshCw, Settings2, Sparkles, Terminal } from 'lucide-react'
import { AtomLogo, Button, Input } from '../ui'
import { useAuthStore } from '../../stores/auth'
import { useLayoutStore } from '../../stores/layout'
import { errorMessage, toast } from '../../stores/toast'
import { atom } from '../../lib/api'
import { cn } from '../../lib/cn'

type Expanded = 'token' | 'apikey' | null

/**
 * How ATOM stores its own credentials, worded so it never claims encryption it does not have: without an OS
 * keyring (Linux "basic_text") secrets are kept unencrypted in the secrets file.
 */
export function secretStorageText(status: AuthStatus | null | undefined): string {
  const s = status?.secretStorage
  if (!s) return 'Stored on this machine'
  if (s.encrypted && s.backend !== 'basic_text') return 'Stored encrypted with the system keyring'
  return `Stored unencrypted in ${s.file} (no system keyring is available)`
}

/** Onboarding card shown inside the agent panel while the user is signed out. */
export function AuthGate() {
  const status = useAuthStore((s) => s.status)
  const loading = useAuthStore((s) => s.loading)
  const refresh = useAuthStore((s) => s.refresh)
  const openLogin = useAuthStore((s) => s.openLogin)
  const openSettings = useLayoutStore((s) => s.openSettings)
  const [expanded, setExpanded] = useState<Expanded>(null)

  if (!status && loading) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-[12.5px] text-muted">
        <AtomLogo size={36} animated />
        <span className="animate-shimmer-text">Checking your Claude sign-in…</span>
      </div>
    )
  }

  const binaryMissing = status?.claudeBinary === null

  return (
    <div className="flex h-full w-full justify-center overflow-y-auto px-4 py-8">
      <div className="my-auto w-full max-w-[400px] animate-fade-in">
        <div className="flex flex-col items-center text-center">
          <div className="relative mb-4">
            <div className="absolute inset-0 rounded-full bg-accent-soft blur-xl" />
            <AtomLogo size={60} animated className="relative" />
          </div>
          <h2 className="text-[17px] font-semibold tracking-tight text-fg">Sign in to start using ATOM</h2>
          <p className="mt-1.5 max-w-[330px] text-[12.5px] leading-relaxed text-muted">
            ATOM runs on Claude Code. Use your <span className="text-fg">Claude Pro or Max</span> subscription — no API key needed.
          </p>
        </div>

        {status?.error && (
          <div className="mt-5 flex items-start gap-2 rounded-lg border border-line bg-danger-soft px-3 py-2.5 text-[12px] text-danger">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <div className="selectable min-w-0 flex-1 break-words">{status.error}</div>
            <button type="button" title="Re-check sign-in status" onClick={() => void refresh(true)} className="rounded p-0.5 hover:bg-hover">
              <RefreshCw size={13} className={cn(loading && 'animate-spin')} />
            </button>
          </div>
        )}

        {binaryMissing && (
          <div className="mt-5 rounded-lg border border-line bg-warning-soft px-3.5 py-3 text-[12px] text-fg">
            <div className="flex items-center gap-2 font-medium text-warning">
              <Terminal size={14} />
              Claude Code binary not found
            </div>
            <ol className="mt-2 list-decimal space-y-1 pl-4 text-muted">
              <li>
                Reinstall dependencies (<code className="rounded bg-active px-1 font-mono text-[11px] text-fg">npm install</code>) so the binary bundled with the Agent SDK is
                present, or
              </li>
              <li>
                install Claude Code globally (<code className="rounded bg-active px-1 font-mono text-[11px] text-fg">npm i -g @anthropic-ai/claude-code</code>) and point ATOM to it
                in Settings → Models &amp; Agent.
              </li>
            </ol>
            <div className="mt-2.5 flex gap-2">
              <Button size="xs" variant="secondary" icon={<Settings2 size={12} />} onClick={() => openSettings('agent')}>
                Open settings
              </Button>
              <Button size="xs" variant="ghost" icon={<RefreshCw size={12} className={cn(loading && 'animate-spin')} />} onClick={() => void refresh(true)}>
                Re-check
              </Button>
            </div>
          </div>
        )}

        <div className="mt-6 flex flex-col gap-2.5">
          <button
            type="button"
            disabled={binaryMissing}
            onClick={() => openLogin('claudeai')}
            className={cn(
              'group flex w-full items-center gap-3 rounded-xl bg-accent px-4 py-3 text-left text-accent-fg shadow-glow transition-all duration-150',
              'hover:bg-accent-hover disabled:pointer-events-none disabled:opacity-50'
            )}
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-fg/15">
              <Sparkles size={17} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13.5px] font-semibold">Sign in with Claude</span>
              <span className="block text-[11.5px] opacity-80">Pro / Max subscription · opens your browser</span>
            </span>
            <span className="text-[16px] opacity-70 transition-transform group-hover:translate-x-0.5">→</span>
          </button>

          <OptionCard
            icon={<KeyRound size={15} />}
            title="Use a long-lived token"
            subtitle="For CI-style setups or when browser login is not possible"
            open={expanded === 'token'}
            onToggle={() => setExpanded(expanded === 'token' ? null : 'token')}
          >
            <TokenPanel disabled={binaryMissing} onGenerate={() => openLogin('setup-token')} />
          </OptionCard>

          <OptionCard
            icon={<Lock size={15} />}
            title="Use an Anthropic API key"
            subtitle="Pay-as-you-go billing from the Anthropic Console"
            open={expanded === 'apikey'}
            onToggle={() => setExpanded(expanded === 'apikey' ? null : 'apikey')}
          >
            <SecretForm
              kind="apikey"
              placeholder="sk-ant-api03-…"
              hint={`${secretStorageText(status)} and passed to Claude Code as ANTHROPIC_API_KEY.`}
              save={(v) => atom.auth.setApiKey(v)}
              successMessage="API key saved"
            />
          </OptionCard>

          <button
            type="button"
            disabled={binaryMissing}
            onClick={() => openLogin('console')}
            className="mt-1 inline-flex items-center justify-center gap-1.5 self-center rounded-md px-2 py-1 text-[12px] text-muted transition-colors hover:bg-hover hover:text-fg disabled:opacity-50"
          >
            <Globe size={13} />
            Sign in with Anthropic Console
          </button>
        </div>

        <p className="mt-6 text-center text-[11px] leading-relaxed text-subtle">
          Sign-in runs the official Claude Code login — ATOM never sees your password.
          <br />
          Subscription sign-in is intended for your personal use of ATOM Code.
        </p>
      </div>
    </div>
  )
}

function OptionCard({
  icon,
  title,
  subtitle,
  open,
  onToggle,
  children
}: {
  icon: ReactNode
  title: string
  subtitle: string
  open: boolean
  onToggle(): void
  children: ReactNode
}) {
  return (
    <div className={cn('overflow-hidden rounded-xl border bg-elevated transition-colors', open ? 'border-line-strong' : 'border-line hover:border-line-strong')}>
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-center gap-3 px-4 py-2.5 text-left">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-active text-muted">{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-medium text-fg">{title}</span>
          <span className="block truncate text-[11.5px] text-muted">{subtitle}</span>
        </span>
        <ChevronDown size={15} className={cn('text-subtle transition-transform duration-150', open && 'rotate-180')} />
      </button>
      {open && <div className="border-t border-line bg-panel px-4 py-3 animate-fade-in">{children}</div>}
    </div>
  )
}

function TokenPanel({ onGenerate, disabled }: { onGenerate(): void; disabled: boolean }) {
  const status = useAuthStore((s) => s.status)
  return (
    <div className="flex flex-col gap-3">
      <div className="text-[12px] leading-relaxed text-muted">
        <span className="text-fg">Generate</span> runs <code className="rounded bg-active px-1 font-mono text-[11px] text-fg">claude setup-token</code> and saves the token
        automatically. Already have one? Paste it below.
      </div>
      <Button size="sm" variant="secondary" icon={<KeyRound size={13} />} onClick={onGenerate} disabled={disabled}>
        Generate a token
      </Button>
      <SecretForm
        kind="token"
        placeholder="sk-ant-oat01-…"
        hint={`${secretStorageText(status)} and passed to Claude Code as CLAUDE_CODE_OAUTH_TOKEN.`}
        save={(v) => atom.auth.setOAuthToken(v)}
        successMessage="Long-lived token saved"
      />
    </div>
  )
}

/** Masked input that stores a secret through the auth service, then refreshes the auth store. */
export function SecretForm({
  kind,
  placeholder,
  hint,
  save,
  successMessage,
  onSaved
}: {
  kind: 'apikey' | 'token'
  placeholder: string
  hint?: string
  save(value: string): Promise<unknown>
  successMessage: string
  onSaved?(): void
}) {
  const [value, setValue] = useState('')
  const [reveal, setReveal] = useState(false)
  const [busy, setBusy] = useState(false)
  const trimmed = value.trim()
  const expectedPrefix = kind === 'apikey' ? 'sk-ant-api' : 'sk-ant-oat'
  const looksWrong = trimmed.length > 8 && !trimmed.startsWith(kind === 'apikey' ? 'sk-ant-' : 'sk-ant-oat')

  const submit = async (): Promise<void> => {
    if (!trimmed || busy) return
    setBusy(true)
    try {
      await save(trimmed)
      await useAuthStore.getState().refresh(true)
      setValue('')
      toast.success(successMessage, 'ATOM Code will use it for new agent sessions.')
      onSaved?.()
    } catch (err) {
      toast.error('Could not save credential', errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex gap-2">
        <Input
          inputSize="sm"
          className="flex-1"
          type={reveal ? 'text' : 'password'}
          placeholder={placeholder}
          value={value}
          autoComplete="off"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void submit()
            }
          }}
          right={
            <button type="button" title={reveal ? 'Hide' : 'Show'} onClick={() => setReveal(!reveal)} className="text-subtle hover:text-fg">
              {reveal ? <EyeOff size={13} /> : <Eye size={13} />}
            </button>
          }
        />
        <Button size="sm" variant="primary" disabled={!trimmed} loading={busy} onClick={() => void submit()}>
          Save
        </Button>
      </div>
      {looksWrong ? (
        <div className="text-[11px] text-warning">This does not look like {kind === 'apikey' ? 'an Anthropic API key' : 'a Claude Code token'} (expected “{expectedPrefix}…”).</div>
      ) : (
        hint && <div className="text-[11px] text-subtle">{hint}</div>
      )}
    </div>
  )
}
