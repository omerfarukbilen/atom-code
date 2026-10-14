import type { CSSProperties } from 'react'
import {
  BookOpen,
  Bot,
  Brain,
  Bug,
  CodeXml,
  Compass,
  Database,
  Feather,
  FileText,
  FlaskConical,
  Gauge,
  GitBranch,
  GraduationCap,
  Hammer,
  Layers,
  Lightbulb,
  ListChecks,
  MessageCircleQuestion,
  Microscope,
  Palette,
  PenTool,
  Puzzle,
  Rocket,
  ScanSearch,
  ShieldCheck,
  Sparkles,
  Target,
  Telescope,
  Terminal,
  Workflow,
  Wrench,
  Zap,
  type LucideIcon
} from 'lucide-react'

/**
 * Explicit map of the lucide icons available to agent modes (built-in modes + the custom-mode picker).
 * Resolving names through this map keeps the bundle small (no `import *`).
 */
export const MODE_ICONS: Record<string, LucideIcon> = {
  Bot,
  ListChecks,
  MessageCircleQuestion,
  Bug,
  ScanSearch,
  FlaskConical,
  Sparkles,
  Rocket,
  ShieldCheck,
  BookOpen,
  CodeXml,
  Hammer,
  Wrench,
  Brain,
  Zap,
  Palette,
  Database,
  GitBranch,
  Terminal,
  FileText,
  Gauge,
  Lightbulb,
  Puzzle,
  Feather,
  Layers,
  Compass,
  Target,
  Microscope,
  PenTool,
  Telescope,
  GraduationCap,
  Workflow
}

export const MODE_ICON_NAMES = Object.keys(MODE_ICONS)

/** Preset accent colors for custom modes (mode colors are data, applied via inline style). */
export const MODE_COLOR_PRESETS = ['#7c8cff', '#4fd1c5', '#f6ad55', '#fc8181', '#b794f4', '#68d391', '#63b3ed', '#f687b3', '#ecc94b', '#a0aec0']

export function resolveModeIcon(name: string | undefined): LucideIcon {
  return (name && MODE_ICONS[name]) || Sparkles
}

export function ModeIcon({ name, size = 14, className, style }: { name?: string; size?: number; className?: string; style?: CSSProperties }) {
  const Icon = resolveModeIcon(name)
  return <Icon size={size} className={className} style={style} />
}

/** Tinted rounded square with the mode icon in the mode color. */
export function ModeBadgeIcon({ icon, color, size = 30 }: { icon?: string; color: string; size?: number }) {
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-lg"
      style={{ width: size, height: size, color, background: `color-mix(in srgb, ${color} 16%, transparent)` }}
    >
      <ModeIcon name={icon} size={Math.round(size * 0.5)} />
    </span>
  )
}
