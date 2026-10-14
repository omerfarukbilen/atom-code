import { useState } from 'react'
import { BarChart3, ExternalLink, Globe, KeyRound, Lock, LogIn, LogOut, ShieldCheck, Trash2 } from 'lucide-react'
import { Badge, Button, confirmDialog } from '../../ui'
import { AccountCard } from '../../auth/AccountCard'
import { SecretForm, secretStorageText } from '../../auth/AuthGate'
import { useAuthStore } from '../../../stores/auth'
import { errorMessage, toast } from '../../../stores/toast'
import { atom } from '../../../lib/api'
import { SectionHeader, SettingGroup, SettingRow, Searchable } from '../controls'

export function AccountSection() {
  const status = useAuthStore((s) => s.status)
  const openLogin = useAuthStore((s) => s.openLogin)
  const refresh = useAuthStore((s) => s.refresh)
  const [busy, setBusy] = useState<string | null>(null)
  const loggedIn = !!status?.loggedIn

  const signOut = async (): Promise<void> => {
    const ok = await confirmDialog({
      title: 'Sign out of Claude Code?',
      message: 'This runs “claude auth logout” and removes the API key and token stored by ATOM Code. Running chats will stop working until you sign in again.',
      confirmLabel: 'Sign out',
      danger: true
    })
    if (!ok) return
    setBusy('logout')
    try {
      await atom.auth.logout()
      await refresh(true)
      toast.success('Signed out')
    } catch (err) {
      toast.error('Sign out failed', errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  const clearSecret = async (kind: 'apikey' | 'token'): Promise<void> => {
    const ok = await confirmDialog({
      title: kind === 'apikey' ? 'Remove the stored API key?' : 'Remove the stored token?',
      message: 'ATOM Code will fall back to your Claude Code login (if any) for new agent sessions.',
      confirmLabel: 'Remove',
      danger: true
    })
    if (!ok) return
    setBusy(kind)
    try {
      if (kind === 'apikey') await atom.auth.setApiKey(null)
      else await atom.auth.setOAuthToken(null)
      await refresh(true)
      toast.success(kind === 'apikey' ? 'API key removed' : 'Token removed')
    } catch (err) {
      toast.error('Could not remove credential', errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div>
      <SectionHeader title="Account" description="ATOM Code signs in through the official Claude Code CLI. Your Claude Pro / Max subscription powers every agent chat." />

      <SettingGroup flush>
        <Searchable terms="account email plan subscription claude code version binary path status">
          <AccountCard className="mb-3" />
        </Searchable>
        <Searchable terms="sign in sign out login logout usage">
          <div className="flex flex-wrap items-center gap-2">
            {loggedIn ? (
              <Button size="sm" variant="secondary" icon={<LogOut size={13} />} loading={busy === 'logout'} onClick={() => void signOut()}>
                Sign out
              </Button>
            ) : (
              <>
                <Button size="sm" variant="primary" icon={<LogIn size={13} />} onClick={() => openLogin('claudeai')}>
                  Sign in with Claude
                </Button>
                <Button size="sm" variant="secondary" icon={<Globe size={13} />} onClick={() => openLogin('console')}>
                  Anthropic Console
                </Button>
              </>
            )}
            {loggedIn && (
              <Button size="sm" variant="ghost" icon={<LogIn size={13} />} onClick={() => openLogin('claudeai')}>
                Switch account
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              icon={<BarChart3 size={13} />}
              iconRight={<ExternalLink size={11} className="opacity-60" />}
              onClick={() => void atom.app.openExternal('https://claude.ai/settings/usage')}
            >
              View usage
            </Button>
          </div>
        </Searchable>
      </SettingGroup>

      <SettingGroup
        title="Credentials stored by ATOM"
        description={`Optional alternatives to the browser login, only passed to the Claude Code process. ${secretStorageText(status)}.`}
      >
        <SettingRow
          label="Long-lived token"
          keywords="oauth setup-token CLAUDE_CODE_OAUTH_TOKEN"
          badge={status?.hasStoredOAuthToken ? <Badge tone="success">Stored</Badge> : undefined}
          description="Created with `claude setup-token` — uses your subscription without a browser session. Takes precedence over the CLI login."
          stacked
        >
          <div className="flex flex-col gap-2">
            {status?.hasStoredOAuthToken ? (
              <div className="flex items-center gap-2">
                <code className="flex-1 rounded-md border border-line bg-input px-2.5 py-1.5 font-mono text-[12px] text-muted">sk-ant-oat••••••••••••••••</code>
                <Button size="sm" variant="ghost" icon={<Trash2 size={13} />} loading={busy === 'token'} onClick={() => void clearSecret('token')}>
                  Remove
                </Button>
              </div>
            ) : (
              <>
                <SecretForm kind="token" placeholder="Paste a token (sk-ant-oat01-…)" save={(v) => atom.auth.setOAuthToken(v)} successMessage="Long-lived token saved" />
                <div>
                  <Button size="xs" variant="secondary" icon={<KeyRound size={12} />} onClick={() => openLogin('setup-token')}>
                    Generate with claude setup-token
                  </Button>
                </div>
              </>
            )}
          </div>
        </SettingRow>
        <SettingRow
          label="Anthropic API key"
          keywords="api key console ANTHROPIC_API_KEY billing"
          badge={status?.hasStoredApiKey ? <Badge tone="success">Stored</Badge> : undefined}
          description="Pay-as-you-go API billing instead of a subscription. When set, it is used for every agent session."
          stacked
        >
          {status?.hasStoredApiKey ? (
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded-md border border-line bg-input px-2.5 py-1.5 font-mono text-[12px] text-muted">sk-ant-api••••••••••••••••</code>
              <Button size="sm" variant="ghost" icon={<Trash2 size={13} />} loading={busy === 'apikey'} onClick={() => void clearSecret('apikey')}>
                Remove
              </Button>
            </div>
          ) : (
            <SecretForm kind="apikey" placeholder="sk-ant-api03-…" save={(v) => atom.auth.setApiKey(v)} successMessage="API key saved" />
          )}
        </SettingRow>
      </SettingGroup>

      <SettingGroup flush>
        <Searchable terms="privacy policy personal use security">
          <div className="flex items-start gap-3 rounded-lg border border-line bg-panel px-4 py-3 text-[12px] leading-relaxed text-muted">
            <ShieldCheck size={15} className="mt-0.5 shrink-0 text-accent-2" />
            <div>
              ATOM never sees your password — sign-in happens in your browser through Claude Code. Subscription sign-in is intended for your own personal use of ATOM Code;
              when distributing ATOM Code to others, use API-key authentication.
              <span className="ml-1 inline-flex items-center gap-1 text-subtle">
                <Lock size={11} /> Telemetry is always off.
              </span>
            </div>
          </div>
        </Searchable>
      </SettingGroup>
    </div>
  )
}
