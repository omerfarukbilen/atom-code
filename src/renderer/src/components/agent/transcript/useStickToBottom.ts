import { useCallback, useLayoutEffect, useRef, useState, type RefObject, type UIEvent, type WheelEvent } from 'react'

/** Distance from the bottom (px) that still counts as "at the bottom" for auto-follow. */
const STICK_THRESHOLD = 28
/** Distance from the bottom (px) after which the "Jump to latest" button appears. */
const JUMP_THRESHOLD = 180

/** Scroll position per transcript key, so switching chat tabs comes back to where the user was. */
const saved = new Map<string, { top: number; stick: boolean }>()

export interface StickToBottom {
  scrollRef: RefObject<HTMLDivElement | null>
  contentRef: RefObject<HTMLDivElement | null>
  /** The user scrolled away from the bottom. */
  showJump: boolean
  scrollToBottom(behavior?: ScrollBehavior): void
  /** Scroll to the bottom only if the view is currently pinned there. */
  pinIfSticky(): void
  onScroll(e: UIEvent<HTMLDivElement>): void
  onWheel(e: WheelEvent<HTMLDivElement>): void
}

/**
 * Chat-style scrolling: stays pinned to the bottom while content streams in (`follow`), lets the user scroll up
 * freely (wheel up / scrollbar / keys un-pin), and re-pins when they come back to the bottom.
 */
export function useStickToBottom(key: string, follow: boolean): StickToBottom {
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const lastTop = useRef(0)
  const followRef = useRef(follow)
  followRef.current = follow
  const [showJump, setShowJump] = useState(false)

  const distance = (el: HTMLElement): number => el.scrollHeight - el.scrollTop - el.clientHeight

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    const el = scrollRef.current
    if (!el) return
    stick.current = true
    if (behavior === 'smooth') el.scrollTo({ top: el.scrollHeight, behavior })
    else el.scrollTop = el.scrollHeight
    lastTop.current = el.scrollTop
    setShowJump(false)
  }, [])

  const pinIfSticky = useCallback(() => {
    if (stick.current) scrollToBottom()
  }, [scrollToBottom])

  const onScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const d = distance(el)
    if (d <= STICK_THRESHOLD) stick.current = true
    else if (el.scrollTop < lastTop.current - 1) stick.current = false
    lastTop.current = el.scrollTop
    setShowJump(d > JUMP_THRESHOLD)
  }, [])

  const onWheel = useCallback((e: WheelEvent<HTMLDivElement>) => {
    if (e.deltaY < 0) stick.current = false
  }, [])

  // Follow content growth (streaming) and container resizes while pinned.
  useLayoutEffect(() => {
    const el = scrollRef.current
    const content = contentRef.current
    if (!el || !content) return
    const ro = new ResizeObserver((entries) => {
      const containerResized = entries.some((e) => e.target === el)
      if (stick.current && (followRef.current || containerResized)) {
        el.scrollTop = el.scrollHeight
        lastTop.current = el.scrollTop
      } else {
        setShowJump(distance(el) > JUMP_THRESHOLD)
      }
    })
    ro.observe(content)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Restore the saved position for this key (or start at the bottom); remember it when leaving.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const prev = saved.get(key)
    if (prev && !prev.stick) {
      el.scrollTop = prev.top
      lastTop.current = el.scrollTop
      stick.current = false
      setShowJump(distance(el) > JUMP_THRESHOLD)
    } else {
      scrollToBottom()
    }
    return () => {
      saved.set(key, { top: el.scrollTop, stick: stick.current })
    }
  }, [key, scrollToBottom])

  return { scrollRef, contentRef, showJump, scrollToBottom, pinIfSticky, onScroll, onWheel }
}
