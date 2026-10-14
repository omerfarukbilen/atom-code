import { CircleUser } from 'lucide-react'
import { cn } from '../../lib/cn'
import { useAuthStore } from '../../stores/auth'

/** Round avatar with the account initial (accent gradient); a neutral glyph when signed out. */
export function AccountAvatar({ size = 22, className }: { size?: number; className?: string }) {
  const status = useAuthStore((s) => s.status)
  if (!status?.loggedIn) {
    return <CircleUser size={Math.round(size * 0.8)} strokeWidth={1.6} className={cn('text-muted', className)} aria-hidden />
  }
  const source = status.email || status.organization || ''
  const initial = (source.trim()[0] ?? 'A').toUpperCase()
  return (
    <span
      aria-hidden
      className={cn('flex shrink-0 select-none items-center justify-center rounded-full font-semibold text-accent-fg shadow-sm', className)}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.48),
        background: 'linear-gradient(135deg, var(--accent) 0%, var(--accent-2) 100%)'
      }}
    >
      {initial}
    </span>
  )
}
