import { useMemo, useState, type ReactNode } from 'react'
import { Lock, Shield, ShieldAlert, ShieldCheck, ShieldEllipsis, TriangleAlert } from 'lucide-react'
import type { PermissionPolicy } from '@shared/types'
import { PERMISSION_POLICIES } from '@shared/modes'
import { cn } from '../../../lib/cn'
import { useAgentModes, useAgentStore } from '../../../stores/agent'
import { useLayoutStore } from '../../../stores/layout'
import { Button, Menu, Modal, type MenuEntry } from '../../ui'
import { useAnchoredMenu, usePickerRequest } from './useAnchoredMenu'

const SHORT_LABEL: Record<PermissionPolicy, string> = {
  default: 'Ask',
  acceptEdits: 'Auto-edit',
  auto: 'Auto',
  bypassPermissions: 'Full auto'
}

function policyIcon(policy: PermissionPolicy, size = 13): ReactNode {
  switch (policy) {
    case 'default':
      return <Shield size={size} />
    case 'acceptEdits':
      return <ShieldCheck size={size} />
    case 'auto':
      return <ShieldEllipsis size={size} />
    case 'bypassPermissions':
      return <ShieldAlert size={size} />
  }
}

/** Permission policy picker (shield). Full auto asks for confirmation; disabled while the mode forces plan. */
export function PermissionPicker({ chatId }: { chatId: string }) {
  const permission = useAgentStore((s) => s.chats[chatId]?.permission ?? 'default')
  const modeId = useAgentStore((s) => s.chats[chatId]?.modeId ?? '')
  const modes = useAgentModes()
  const mode = useMemo(() => modes.find((m) => m.id === modeId) ?? modes[0], [modes, modeId])
  const forcedPlan = mode.forcedPermissionMode === 'plan'
  const menu = useAnchoredMenu('top-start')
  const [confirmOpen, setConfirmOpen] = useState(false)
  usePickerRequest('permission', menu.openMenu, !forcedPlan)

  const choose = (policy: PermissionPolicy): void => {
    if (policy === 'bypassPermissions' && permission !== 'bypassPermissions') setConfirmOpen(true)
    else useAgentStore.getState().setPermission(policy, chatId)
  }

  const entries: MenuEntry[] = [
    { type: 'header', id: 'h', label: 'Permissions' },
    ...PERMISSION_POLICIES.map<MenuEntry>((p) => ({
      id: p.id,
      label: p.label,
      description: p.description,
      icon: <span className={cn(p.danger && 'text-danger')}>{policyIcon(p.id, 14)}</span>,
      danger: p.danger,
      checked: p.id === permission,
      onSelect: () => choose(p.id)
    })),
    { type: 'separator', id: 's' },
    { id: 'rules', label: 'Allowed & blocked tools…', icon: <Lock size={13} />, onSelect: () => useLayoutStore.getState().openSettings('permissions') }
  ]

  if (forcedPlan) {
    return (
      <span title={`${mode.name} mode is read-only — the agent researches and proposes a plan; nothing is changed until you approve it.`} className="flex shrink-0">
        <button
          type="button"
          disabled
          aria-label="Plan mode is read-only"
          className="pointer-events-none flex h-6 items-center gap-1 rounded-md px-1.5 text-[11.5px] text-subtle opacity-70"
        >
          <Lock size={12} />
          <span className="hidden @lg:inline">Read-only</span>
        </button>
      </span>
    )
  }

  const current = PERMISSION_POLICIES.find((p) => p.id === permission) ?? PERMISSION_POLICIES[0]
  const danger = permission === 'bypassPermissions'

  return (
    <>
      <button
        ref={menu.anchorRef}
        type="button"
        title={`Permissions: ${current.label} — ${current.description}`}
        aria-label={`Permissions: ${current.label}`}
        aria-haspopup="menu"
        aria-expanded={menu.open}
        onClick={menu.toggle}
        className={cn(
          'flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-[11.5px] transition-colors duration-100',
          danger ? 'bg-danger-soft text-danger hover:brightness-125' : 'text-muted hover:bg-hover hover:text-fg',
          menu.open && !danger && 'bg-active text-fg'
        )}
      >
        {policyIcon(permission)}
        <span className={cn(danger ? 'hidden @xs:inline' : 'hidden @lg:inline')}>{SHORT_LABEL[permission]}</span>
      </button>
      <Menu {...menu.props} entries={entries} minWidth={280} className="max-w-[340px]" />
      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Enable Full auto (YOLO)?"
        width="max-w-md"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              size="sm"
              icon={<ShieldAlert size={13} />}
              onClick={() => {
                setConfirmOpen(false)
                useAgentStore.getState().setPermission('bypassPermissions', chatId)
              }}
            >
              Enable Full auto
            </Button>
          </>
        }
      >
        <div className="flex gap-3 px-5 py-4 text-[12.5px] leading-relaxed text-muted">
          <TriangleAlert size={18} className="mt-0.5 shrink-0 text-danger" />
          <div className="space-y-2">
            <p>
              ATOM will run <span className="font-medium text-fg">any command and edit any file without asking</span> — including deleting files,
              installing packages and talking to the network.
            </p>
            <p>Only use this in projects you trust, ideally under version control. You can switch back at any time from this menu.</p>
          </div>
        </div>
      </Modal>
    </>
  )
}
