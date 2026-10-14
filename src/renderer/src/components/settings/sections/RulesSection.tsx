import { useCallback, useEffect, useState } from 'react'
import { FileText, FolderOpen, Plus, RefreshCw } from 'lucide-react'
import { joinPath } from '@shared/paths'
import { Badge, Button, IconButton, Spinner } from '../../ui'
import { useSettingsStore } from '../../../stores/settings'
import { useWorkspaceStore } from '../../../stores/workspace'
import { useEditorStore } from '../../../stores/editor'
import { useLayoutStore } from '../../../stores/layout'
import { errorMessage, toast } from '../../../stores/toast'
import { atom } from '../../../lib/api'
import { Searchable, SectionHeader, SettingGroup, SettingRow, TextAreaField } from '../controls'

function atomMdTemplate(projectName: string): string {
  return `# ${projectName} — rules for ATOM

ATOM reads this file at the start of every chat in this project. Keep it short and specific:
tell the agent what it cannot infer from the code itself.

## Project overview
- What this project does, in one or two sentences.
- Main technologies / frameworks and their versions.

## Commands
- Install: \`npm install\`
- Dev server: \`npm run dev\`
- Typecheck / lint: \`npm run typecheck\`
- Tests: \`npm test\` (single file: \`npm test -- path/to/file\`)

## Code style
- Follow the existing patterns in the surrounding code.
- Prefer small, focused functions and descriptive names.
- No new dependencies without asking first.

## Architecture notes
- Where the important modules live and how they talk to each other.
- Anything surprising (generated files, legacy areas, things not to touch).

## Workflow
- Run the typecheck and the relevant tests before reporting a task as done.
- Keep commits small; use Conventional Commit messages.
`
}

/** Status of a rules file in the workspace root. */
function useFileExists(path: string | null): { exists: boolean | null; recheck(): void } {
  const [exists, setExists] = useState<boolean | null>(null)
  const recheck = useCallback(() => {
    if (!path) {
      setExists(null)
      return
    }
    atom.fs
      .stat(path)
      .then((s) => setExists(s.exists && !s.isDirectory))
      .catch(() => setExists(false))
  }, [path])
  useEffect(() => {
    setExists(null)
    recheck()
  }, [recheck])
  return { exists, recheck }
}

export function RulesSection() {
  const instructions = useSettingsStore((s) => s.settings.agent.customInstructions)
  const update = useSettingsStore((s) => s.update)
  const workspace = useWorkspaceStore((s) => s.workspace)
  const openFolderDialog = useWorkspaceStore((s) => s.openFolderDialog)
  const closeSettings = useLayoutStore((s) => s.closeSettings)
  const atomMdPath = workspace ? joinPath(workspace.path, 'ATOM.md') : null
  const claudeMdPath = workspace ? joinPath(workspace.path, 'CLAUDE.md') : null
  const atomMd = useFileExists(atomMdPath)
  const claudeMd = useFileExists(claudeMdPath)
  const [creating, setCreating] = useState(false)

  const openFile = async (path: string): Promise<void> => {
    try {
      await useEditorStore.getState().openFile(path)
      closeSettings()
    } catch (err) {
      toast.error('Could not open file', errorMessage(err))
    }
  }

  const createAtomMd = async (): Promise<void> => {
    if (!atomMdPath || !workspace) return
    const path = atomMdPath
    setCreating(true)
    try {
      // createFile fails when the file exists: ATOM.md may have appeared since this page checked (agent, git pull…).
      await atom.fs.createFile(path, atomMdTemplate(workspace.name))
      atomMd.recheck()
      toast.success('Created ATOM.md', 'Edit it to teach ATOM about this project.')
      await openFile(path)
    } catch (err) {
      atomMd.recheck()
      const existing = await atom.fs.stat(path).then((st) => st.exists && !st.isDirectory, () => false)
      if (existing) {
        toast.show(
          {
            kind: 'info',
            message: 'ATOM.md already exists',
            detail: 'It was left unchanged.',
            action: { label: 'Open ATOM.md', run: () => void openFile(path) }
          },
          8000
        )
      } else {
        toast.error('Could not create ATOM.md', errorMessage(err))
      }
    } finally {
      setCreating(false)
    }
  }

  const lines = instructions ? instructions.split('\n').length : 0

  return (
    <div>
      <SectionHeader title="Rules" description="Instructions ATOM follows in every chat — your personal preferences plus per-project rules checked into the repository." />

      <SettingGroup title="Global rules">
        <SettingRow
          label="Custom instructions"
          keywords="global rules instructions system prompt preferences"
          description="Appended to the system prompt for every chat in every project. Use it for personal preferences (language, tone, conventions)."
          stacked
        >
          <TextAreaField
            mono
            rows={12}
            value={instructions}
            onCommit={(v) => void update({ agent: { customInstructions: v } })}
            placeholder={'- Answer in English, be concise.\n- Prefer functional React components with hooks.\n- Never commit without asking me first.\n- Use pnpm, not npm.'}
          />
          <div className="mt-1 flex justify-end text-[11px] text-subtle">
            {instructions.length.toLocaleString()} characters · {lines} {lines === 1 ? 'line' : 'lines'}
          </div>
        </SettingRow>
      </SettingGroup>

      <SettingGroup title="Project rules">
        {!workspace ? (
          <Searchable terms="project rules atom.md claude.md workspace">
            <div className="flex items-center gap-3 px-4 py-4">
              <FolderOpen size={16} className="shrink-0 text-subtle" />
              <div className="min-w-0 flex-1 text-[12.5px] text-muted">Open a folder to manage its project rules (ATOM.md).</div>
              <Button size="sm" variant="secondary" onClick={() => void openFolderDialog()}>
                Open folder
              </Button>
            </div>
          </Searchable>
        ) : (
          <>
            <SettingRow
              label="ATOM.md"
              keywords="project rules atom.md file template"
              badge={atomMd.exists === null ? <Spinner size={10} /> : atomMd.exists ? <Badge tone="success">Found</Badge> : <Badge>Not created</Badge>}
              description={
                <>
                  Project rules in <code className="font-mono text-[11px] text-fg">{workspace.name}/ATOM.md</code> are added to the system prompt (up to 20 KB). Commit it so your
                  team shares the same rules.
                </>
              }
            >
              <IconButton title="Re-check" icon={<RefreshCw size={13} />} onClick={atomMd.recheck} />
              {atomMd.exists ? (
                <Button size="sm" variant="secondary" icon={<FileText size={13} />} onClick={() => atomMdPath && void openFile(atomMdPath)}>
                  Open ATOM.md
                </Button>
              ) : (
                <Button size="sm" variant="primary" icon={<Plus size={13} />} loading={creating} disabled={atomMd.exists === null} onClick={() => void createAtomMd()}>
                  Create ATOM.md
                </Button>
              )}
            </SettingRow>
            <SettingRow
              label="CLAUDE.md"
              keywords="claude.md memory project"
              badge={claudeMd.exists ? <Badge tone="success">Found</Badge> : undefined}
              description="Claude Code project memory (CLAUDE.md, .claude/CLAUDE.md and CLAUDE.local.md) is also loaded automatically — ATOM.md and CLAUDE.md work side by side."
            >
              {claudeMd.exists && (
                <Button size="sm" variant="ghost" icon={<FileText size={13} />} onClick={() => claudeMdPath && void openFile(claudeMdPath)}>
                  Open
                </Button>
              )}
            </SettingRow>
          </>
        )}
      </SettingGroup>
    </div>
  )
}
