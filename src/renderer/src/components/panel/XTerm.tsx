import { useEffect, useRef } from 'react'
import { attachTerminal, fitTerminal } from '../../stores/terminal'

/**
 * Hosts one terminal. The xterm instance lives in the terminal store; this component only mounts its
 * persistent DOM host and keeps it sized, so unmounting never ends the shell session.
 */
export function XTerm({ id }: { id: string }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const detach = attachTerminal(id, el)
    let frame = 0
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => fitTerminal(id))
    })
    ro.observe(el)
    return () => {
      cancelAnimationFrame(frame)
      ro.disconnect()
      detach()
    }
  }, [id])

  return <div ref={ref} className="h-full w-full overflow-hidden" />
}
