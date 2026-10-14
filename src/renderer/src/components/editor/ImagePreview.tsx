import { useEffect, useReducer, useRef, useState, type CSSProperties } from 'react'
import { ImageOff, Maximize, Minus, Plus, Scan } from 'lucide-react'
import { basename, extname } from '@shared/paths'
import { useEditorStore } from '../../stores/editor'
import { IconButton } from '../ui'

const ZOOM_STEPS = [0.1, 0.25, 0.33, 0.5, 0.67, 0.8, 1, 1.25, 1.5, 2, 3, 4, 6, 8, 12, 16]

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(2)} MB`
}

const checkerboard: CSSProperties = {
  backgroundImage: 'conic-gradient(var(--hover) 25%, transparent 0 50%, var(--hover) 0 75%, transparent 0)',
  backgroundSize: '16px 16px'
}

/** Image tab: checkerboard canvas, fit / actual size, zoom with buttons or Ctrl/⌘ + wheel. */
export function ImagePreview({ tabId, path }: { tabId: string; path: string }) {
  const data = useEditorStore((s) => s.imageData[tabId])
  const [zoom, setZoom] = useState<'fit' | number>('fit')
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null)
  const [failed, setFailed] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const [, relayout] = useReducer((x: number) => x + 1, 0)

  useEffect(() => {
    setFailed(false)
  }, [data?.src])

  // "Fit" depends on the viewport size.
  useEffect(() => {
    const el = containerRef.current
    if (!el || zoom !== 'fit') return
    const ro = new ResizeObserver(() => relayout())
    ro.observe(el)
    return () => ro.disconnect()
  }, [zoom])

  const fitScale = (): number => {
    const el = containerRef.current
    if (!el || !natural) return 1
    return Math.min(1, (el.clientWidth - 48) / natural.w, (el.clientHeight - 48) / natural.h)
  }
  const current = zoom === 'fit' ? fitScale() : zoom

  const step = (dir: 1 | -1): void => {
    const z = current
    const next = dir > 0 ? ZOOM_STEPS.find((s) => s > z + 0.001) : [...ZOOM_STEPS].reverse().find((s) => s < z - 0.001)
    if (next) setZoom(next)
  }

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      step(e.deltaY < 0 ? 1 : -1)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  })

  if (!data) return null

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-app">
      <div ref={containerRef} className="relative min-h-0 flex-1 overflow-auto" onDoubleClick={() => setZoom(zoom === 'fit' ? 1 : 'fit')}>
        <div className="flex min-h-full min-w-full items-center justify-center p-6">
          {failed ? (
            <div className="flex flex-col items-center gap-2 text-[12px] text-muted">
              <ImageOff size={28} className="text-subtle" />
              This image could not be displayed.
            </div>
          ) : (
            <div className="rounded-sm shadow-pop ring-1 ring-line" style={checkerboard}>
              <img
                src={data.src}
                alt={basename(path)}
                draggable={false}
                onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
                onError={() => setFailed(true)}
                className="block max-w-none select-none"
                style={
                  natural
                    ? { width: Math.max(1, Math.round(natural.w * current)), height: Math.max(1, Math.round(natural.h * current)), imageRendering: current >= 3 ? 'pixelated' : 'auto' }
                    : { visibility: 'hidden' }
                }
              />
            </div>
          )}
        </div>
      </div>
      <div className="pointer-events-none absolute bottom-3 left-0 right-0 flex justify-center">
        <div className="pointer-events-auto flex items-center gap-1 rounded-lg border border-line bg-overlay px-1.5 py-1 text-[11.5px] text-muted shadow-pop">
          <span className="px-1.5 font-mono">{natural ? `${natural.w} × ${natural.h}` : '—'}</span>
          <span className="text-subtle">·</span>
          <span className="px-1.5">{formatBytes(data.size)}</span>
          <span className="text-subtle">·</span>
          <span className="px-1.5 uppercase">{extname(path).slice(1) || 'image'}</span>
          <div className="mx-1 h-4 w-px bg-line" />
          <IconButton title="Zoom Out" size="xs" icon={<Minus size={12} />} onClick={() => step(-1)} />
          <button type="button" title="Reset zoom" className="min-w-[46px] rounded px-1 py-0.5 text-center font-mono hover:bg-hover hover:text-fg" onClick={() => setZoom(1)}>
            {Math.round(current * 100)}%
          </button>
          <IconButton title="Zoom In" size="xs" icon={<Plus size={12} />} onClick={() => step(1)} />
          <IconButton title="Fit to Window" size="xs" active={zoom === 'fit'} icon={<Maximize size={12} />} onClick={() => setZoom('fit')} />
          <IconButton title="Actual Size" size="xs" active={zoom === 1} icon={<Scan size={12} />} onClick={() => setZoom(1)} />
        </div>
      </div>
    </div>
  )
}
