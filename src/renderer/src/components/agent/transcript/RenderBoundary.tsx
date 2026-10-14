import { Component, type ErrorInfo, type ReactNode } from 'react'
import { TriangleAlert } from 'lucide-react'
import { cn } from '../../../lib/cn'

interface RenderBoundaryProps {
  children: ReactNode
  /** What could not be shown ("this message", "this prompt", …). */
  what?: string
  /** When this value changes after a failure, rendering is retried (e.g. the item was updated). */
  resetKey?: unknown
  className?: string
}

interface RenderBoundaryState {
  error: Error | null
}

/**
 * Contains a render error to one transcript block. Agent output is untrusted input: one malformed message
 * must show a placeholder instead of unmounting the whole window (and crashing again when the chat is restored).
 */
export class RenderBoundary extends Component<RenderBoundaryProps, RenderBoundaryState> {
  state: RenderBoundaryState = { error: null }

  static getDerivedStateFromError(error: unknown): RenderBoundaryState {
    return { error: error instanceof Error ? error : new Error(String(error)) }
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error('[agent] could not render part of the transcript', error, info.componentStack)
  }

  componentDidUpdate(prev: RenderBoundaryProps): void {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null })
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div
        role="alert"
        className={cn('flex items-start gap-2 rounded-md bg-warning-soft px-2.5 py-1.5 text-[12px] text-warning', this.props.className)}
      >
        <TriangleAlert size={13} className="mt-[2px] shrink-0" />
        <span className="min-w-0 flex-1">
          <span className="text-fg">Could not display {this.props.what ?? 'this part of the conversation'}.</span>
          <span className="selectable ml-1 break-words text-muted">{error.message}</span>
        </span>
        <button
          type="button"
          onClick={() => this.setState({ error: null })}
          className="shrink-0 rounded px-1.5 text-[11.5px] text-muted hover:bg-hover hover:text-fg"
        >
          Retry
        </button>
      </div>
    )
  }
}
