import { useId } from 'react'

/**
 * ATOM Code mark: a bold "A" wrapped by an electron orbit with a glowing nucleus.
 * When `animated`, the electron travels along the orbit and the nucleus pulses.
 */
export function AtomLogo({ size = 24, animated = false, className }: { size?: number; animated?: boolean; className?: string }) {
  const id = useId().replace(/:/g, '')
  const orbit = 'M 9.5 37.5 A 22.5 7.4 0 1 0 54.5 37.5 A 22.5 7.4 0 1 0 9.5 37.5'
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" className={className} aria-label="ATOM Code" role="img">
      <defs>
        <linearGradient id={`a-${id}`} x1="18" y1="15" x2="47" y2="49" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="var(--accent)" />
          <stop offset="1" stopColor="var(--accent-2)" />
        </linearGradient>
        <linearGradient id={`o-${id}`} x1="9" y1="34" x2="55" y2="41" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="var(--accent-2)" />
          <stop offset="1" stopColor="var(--accent)" />
        </linearGradient>
        <radialGradient id={`n-${id}`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#fff" />
          <stop offset="0.5" stopColor="var(--accent-2)" />
          <stop offset="1" stopColor="var(--accent-2)" />
        </radialGradient>
      </defs>
      <g transform="rotate(-16 32 37.5)">
        <path d="M 9.5 37.5 A 22.5 7.4 0 0 1 54.5 37.5" stroke={`url(#o-${id})`} strokeWidth="2.2" strokeLinecap="round" opacity="0.55" />
      </g>
      <path d="M 18.75 48 L 32 15.6 L 45.25 48" stroke={`url(#a-${id})`} strokeWidth="5.6" strokeLinecap="round" strokeLinejoin="round" />
      <g transform="rotate(-16 32 37.5)">
        <path d="M 9.5 37.5 A 22.5 7.4 0 0 0 54.5 37.5" stroke={`url(#o-${id})`} strokeWidth="2.2" strokeLinecap="round" />
        {animated ? (
          <circle r="2.3" fill="var(--accent)">
            <animateMotion dur="2.4s" repeatCount="indefinite" path={orbit} />
          </circle>
        ) : (
          <circle cx="54.5" cy="37.5" r="2.3" fill="var(--accent)" />
        )}
      </g>
      <circle cx="32" cy="36.9" r="3.6" fill={`url(#n-${id})`} className={animated ? 'animate-atom-pulse' : undefined} />
    </svg>
  )
}
