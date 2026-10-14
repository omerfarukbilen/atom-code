import { highlightSegments } from '../../lib/fuzzy'
import { cn } from '../../lib/cn'

/** Renders text with fuzzy-match positions emphasised. Characters before `mutedUntil` use the muted color. */
export function Highlight({ text, positions, className, mutedUntil = 0 }: { text: string; positions?: readonly number[]; className?: string; mutedUntil?: number }) {
  const segments = highlightSegments(text, positions ?? [])
  let offset = 0
  return (
    <span className={className}>
      {segments.flatMap((seg, i) => {
        const start = offset
        offset += seg.text.length
        // Split a segment that straddles the muted boundary.
        const parts: { text: string; muted: boolean }[] =
          start < mutedUntil && offset > mutedUntil
            ? [
                { text: seg.text.slice(0, mutedUntil - start), muted: true },
                { text: seg.text.slice(mutedUntil - start), muted: false }
              ]
            : [{ text: seg.text, muted: offset <= mutedUntil }]
        return parts.map((p, j) => (
          <span key={`${i}:${j}`} className={cn(p.muted && 'text-muted', seg.match && 'font-semibold text-accent')}>
            {p.text}
          </span>
        ))
      })}
    </span>
  )
}
