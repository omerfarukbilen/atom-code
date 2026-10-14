import { useId } from 'react'

/** ATOM Code mark: a glowing nucleus with three electron orbits. */
export function AtomLogo({ size = 24, animated = false, className }: { size?: number; animated?: boolean; className?: string }) {
  const id = useId().replace(/:/g, '')
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" className={className} aria-label="ATOM Code">
      <defs>
        <linearGradient id={`g-${id}`} x1="8" y1="8" x2="56" y2="56" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="var(--accent)" />
          <stop offset="1" stopColor="var(--accent-2)" />
        </linearGradient>
        <radialGradient id={`n-${id}`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#fff" />
          <stop offset="0.45" stopColor="var(--accent-2)" />
          <stop offset="1" stopColor="var(--accent)" />
        </radialGradient>
      </defs>
      <g className={animated ? 'animate-orbit' : undefined} style={{ transformOrigin: '32px 32px' }}>
        <ellipse cx="32" cy="32" rx="27" ry="10.5" stroke={`url(#g-${id})`} strokeWidth="3" />
        <ellipse cx="32" cy="32" rx="27" ry="10.5" stroke={`url(#g-${id})`} strokeWidth="3" transform="rotate(60 32 32)" />
        <ellipse cx="32" cy="32" rx="27" ry="10.5" stroke={`url(#g-${id})`} strokeWidth="3" transform="rotate(120 32 32)" />
      </g>
      <circle cx="32" cy="32" r="6.5" fill={`url(#n-${id})`} />
    </svg>
  )
}
