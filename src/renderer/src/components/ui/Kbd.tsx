import { formatKeybinding } from '../../lib/platform'
import { cn } from '../../lib/cn'

/** Renders a keybinding such as "mod+shift+p" as platform-specific key caps. */
export function Kbd({ keys, className }: { keys: string; className?: string }) {
  return <kbd className={cn('kbd', className)}>{formatKeybinding(keys)}</kbd>
}
