import { useEffect, useState, type ReactNode } from 'react'
import { KeyRound, RefreshCw, Terminal, User } from 'lucide-react'
import type { AuthStatus } from '@shared/types'
import { Badge, IconButton, type BadgeTone } from '../ui'
import { authMethodLabel, planLabel, useAuthStore } from '../../stores/auth'
import { cn } from '../../lib/cn'

function relativeTime(ts: number, now: number): string {
  const s = Math.max(0, Math.round((now - ts) / 1000))
  if (s < 10) return 'just now'
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  return `${h} h ago`
}

function planTone(plan: string | null): BadgeTone {
  if (!plan) return 'neutral'
  if (plan === 'Max' || plan === 'Enterprise') return 'accent'
  if (plan === 'Pro' || plan === 'Team') return 'info'
  if (plan === 'API' || plan === 'Console') return 'warning'
  return 'neutral'
}

/** Gradient avatar with the account initial. */
export function AccountAvatar({ status, size = 40 }: { status: AuthStatus | null; size?: number }) {
  const letter = status?.loggedIn ? (status.email?.trim()[0] ?? status.organization?.trim()[0] ?? 'A').toUpperCase() : null
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full font-semibold text-accent-fg"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.42,
        background: letter ? 'linear-gradient(135deg, var(--accent), var(--accent-2))' : 'var(--active)'
      }}
    >
      {letter ?? <User size={size * 0.45} className="text-muted" />}
    </div>
  )
}

/**
 * Account summary: email, plan badge, auth method, Claude Code version and binary path.
 * Reads the auth store when `status` is not passed.
 */
export function AccountCard({ status: statusProp, className }: { status?: AuthStatus | null; className?: string }) {
  const storeStatus = useAuthStore((s) => s.status)
  const loading = useAuthStore((s) => s.loading)
  const refresh = useAuthStore((s) => s.refresh)
  const status = statusProp === undefined ? storeStatus : statusProp
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])

  const plan = planLabel(status)
  const loggedIn = !!status?.loggedIn
  const title = loggedIn ? (status?.email ?? status?.organization ?? authMethodLabel(status)) : 'Not signed in'

  return (
    <div className={cn('overflow-hidden rounded-lg border border-line bg-elevated', className)}>
      <div className="flex items-center gap-3 px-4 py-3.5">
        <AccountAvatar status={status} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="selectable truncate text-[14px] font-semibold text-fg" title={title}>
              {title}
            </span>
            {plan && <Badge tone={planTone(plan)}>{plan}</Badge>}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[12px] text-muted">
            <span className={cn('inline-block h-1.5 w-1.5 rounded-full', loggedIn ? 'bg-success' : 'bg-subtle')} />
            <span className="truncate">
              {authMethodLabel(status)}
              {loggedIn && status?.organization && status.email ? ` · ${status.organization}` : ''}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {status && <span className="hidden text-[11px] text-subtle sm:inline">Checked {relativeTime(status.checkedAt, now)}</span>}
          <IconButton
            title="Re-check sign-in status"
            icon={<RefreshCw size={14} className={cn(loading && 'animate-spin')} />}
            onClick={() => void refresh(true)}
            disabled={loading}
          />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-x-6 gap-y-2 border-t border-line bg-panel px-4 py-3 text-[12px] md:grid-cols-2">
        <InfoLine icon={<Terminal size={13} />} label="Claude Code">
          {status === null ? (
            <span className="text-subtle">Checking…</span>
          ) : status.claudeBinary === null ? (
            <span className="text-danger">Not found</span>
          ) : (
            <span className="text-fg">{status.claudeVersion ? `v${status.claudeVersion.replace(/^v/, '')}` : 'Unknown version'}</span>
          )}
        </InfoLine>
        <InfoLine icon={<KeyRound size={13} />} label="Stored credentials">
          <span className="text-fg">
            {[status?.hasStoredOAuthToken && 'Token', status?.hasStoredApiKey && 'API key'].filter(Boolean).join(' + ') || 'None'}
          </span>
        </InfoLine>
        {status?.claudeBinary && (
          <div className="col-span-full flex min-w-0 items-center gap-2 text-subtle">
            <span className="shrink-0">Binary</span>
            <code className="selectable min-w-0 truncate rounded bg-input px-1.5 py-0.5 font-mono text-[11px] text-muted" title={status.claudeBinary}>
              {status.claudeBinary}
            </code>
          </div>
        )}
      </div>
    </div>
  )
}

function InfoLine({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="text-subtle">{icon}</span>
      <span className="text-subtle">{label}</span>
      <span className="min-w-0 truncate">{children}</span>
    </div>
  )
}
