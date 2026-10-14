import { create } from 'zustand'
import type { AuthStatus, LoginMode } from '@shared/types'
import { atom } from '../lib/api'
import { errorMessage } from './toast'
import type { AuthStoreApi } from './contracts'
import { registerCommands } from './commands'

/**
 * Authentication state (Claude subscription / token / API key) mirrored from the main process.
 *
 * The status is refreshed on start, when the window regains focus, every 5 minutes and whenever main
 * broadcasts a change (`atom.auth.onStatus`, e.g. after a login or logout).
 */

const PERIODIC_REFRESH_MS = 5 * 60 * 1000
/** Focus events can fire in bursts; do not re-check more often than this. */
const FOCUS_THROTTLE_MS = 15 * 1000

let inflight: Promise<void> | null = null
let inflightForced = false

export const useAuthStore = create<AuthStoreApi>((set, get) => ({
  status: null,
  loading: false,
  loginOpen: false,
  loginMode: 'claudeai',

  refresh: async (force = false) => {
    // Coalesce concurrent refreshes; a forced refresh waits for a non-forced one and then re-runs.
    if (inflight && (!force || inflightForced)) return inflight
    if (inflight) await inflight.catch(() => undefined)
    inflightForced = force
    set({ loading: true })
    inflight = (async () => {
      try {
        const status = await atom.auth.getStatus(force)
        set({ status, loading: false })
      } catch (err) {
        const prev = get().status
        const fallback: AuthStatus = {
          loggedIn: prev?.loggedIn ?? false,
          method: prev?.method ?? 'none',
          email: prev?.email,
          organization: prev?.organization,
          subscriptionType: prev?.subscriptionType,
          apiProvider: prev?.apiProvider,
          // Unknown (not "missing"): keep whatever we knew so the UI does not claim the binary is gone.
          claudeBinary: prev ? prev.claudeBinary : '',
          claudeVersion: prev?.claudeVersion,
          hasStoredApiKey: prev?.hasStoredApiKey ?? false,
          hasStoredOAuthToken: prev?.hasStoredOAuthToken ?? false,
          error: `Could not check sign-in status: ${errorMessage(err)}`,
          checkedAt: Date.now()
        }
        set({ status: fallback, loading: false })
      } finally {
        inflight = null
        inflightForced = false
      }
    })()
    return inflight
  },

  openLogin: (mode: LoginMode = 'claudeai') => set({ loginOpen: true, loginMode: mode }),
  closeLogin: () => set({ loginOpen: false })
}))

// ── Background refresh wiring (module singletons) ───────────────────────────

let lastFocusRefresh = 0

function onWindowFocus(): void {
  const now = Date.now()
  if (now - lastFocusRefresh < FOCUS_THROTTLE_MS) return
  lastFocusRefresh = now
  void useAuthStore.getState().refresh()
}

atom.auth.onStatus((status) => {
  useAuthStore.setState({ status, loading: false })
})

window.addEventListener('focus', onWindowFocus)
setInterval(() => void useAuthStore.getState().refresh(), PERIODIC_REFRESH_MS)
void useAuthStore.getState().refresh()

const signedOut = (): boolean => !useAuthStore.getState().status?.loggedIn

registerCommands([
  { id: 'account.signIn', title: 'Sign in with Claude (Pro / Max)', category: 'Account', icon: 'LogIn', when: signedOut, run: () => useAuthStore.getState().openLogin('claudeai') },
  { id: 'account.signInConsole', title: 'Sign in with Anthropic Console', category: 'Account', icon: 'Globe', when: signedOut, run: () => useAuthStore.getState().openLogin('console') },
  { id: 'account.setupToken', title: 'Create Long-Lived Token (claude setup-token)', category: 'Account', icon: 'KeyRound', run: () => useAuthStore.getState().openLogin('setup-token') },
  { id: 'account.refresh', title: 'Re-check Sign-in Status', category: 'Account', icon: 'RefreshCw', run: () => useAuthStore.getState().refresh(true) },
  { id: 'account.usage', title: 'Open Usage & Limits (claude.ai)', category: 'Account', icon: 'ChartColumn', run: () => atom.app.openExternal('https://claude.ai/settings/usage') }
])

// ── Display helpers shared by the auth / settings UI ────────────────────────

/** "Max", "Pro", "Team", … from the subscription type, or a sensible label for non-subscription methods. */
export function planLabel(status: AuthStatus | null): string | null {
  if (!status?.loggedIn) return null
  const sub = status.subscriptionType?.trim()
  if (sub) {
    const s = sub.toLowerCase()
    if (s.includes('max')) return 'Max'
    if (s.includes('pro')) return 'Pro'
    if (s.includes('team')) return 'Team'
    if (s.includes('enterprise')) return 'Enterprise'
    if (s.includes('free')) return 'Free'
    return sub.charAt(0).toUpperCase() + sub.slice(1)
  }
  switch (status.method) {
    case 'api-key':
      return 'API'
    case 'console':
      return 'Console'
    case 'third-party':
      return status.apiProvider ? status.apiProvider : 'Cloud'
    case 'oauth-token':
      return 'Token'
    default:
      return null
  }
}

export function authMethodLabel(status: AuthStatus | null): string {
  switch (status?.method) {
    case 'claude-subscription':
      return 'Claude subscription'
    case 'oauth-token':
      return 'Long-lived token'
    case 'api-key':
      return 'Anthropic API key'
    case 'console':
      return 'Anthropic Console'
    case 'third-party':
      return status.apiProvider ? `Third-party (${status.apiProvider})` : 'Third-party provider'
    default:
      return 'Not signed in'
  }
}
