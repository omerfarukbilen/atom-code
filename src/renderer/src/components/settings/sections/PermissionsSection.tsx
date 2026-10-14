import { ShieldAlert, ShieldCheck, Info } from 'lucide-react'
import { PERMISSION_POLICIES } from '@shared/modes'
import { Badge } from '../../ui'
import { useSettingsStore } from '../../../stores/settings'
import { useLayoutStore } from '../../../stores/layout'
import { ListEditor, Searchable, SectionHeader, SettingGroup, SettingRow } from '../controls'

/**
 * Claude Code permission rules: `Tool` or `Tool(specifier)`, e.g. `Bash(npm test:*)`, `Read(./src/**)`,
 * `WebFetch(domain:github.com)`, `mcp__server__tool`.
 */
export function validatePermissionRule(rule: string): string | null {
  const r = rule.trim()
  if (!r) return 'Enter a rule.'
  const m = /^([A-Za-z][\w-]*)(?:\((.*)\))?$/.exec(r)
  if (!m) {
    if (r.includes('(') && !r.endsWith(')')) return 'Missing closing parenthesis — use Tool(pattern).'
    return 'Use the form Tool or Tool(pattern), e.g. Bash(npm test:*).'
  }
  if (m[2] !== undefined && m[2].trim() === '') return 'The pattern inside the parentheses is empty.'
  if (/^[a-z]/.test(m[1]) && !m[1].startsWith('mcp__')) return 'Tool names start with an uppercase letter (Bash, Read, WebFetch…) or mcp__.'
  return null
}

const ALLOW_EXAMPLES = [
  { value: 'Bash(npm test:*)', label: 'Run the test script with any arguments' },
  { value: 'Bash(npm run lint)', label: 'Run the linter' },
  { value: 'Bash(git status)', label: 'Check git status' },
  { value: 'WebFetch(domain:github.com)', label: 'Fetch pages from github.com' },
  { value: 'Read(./docs/**)', label: 'Read anything under docs/' }
]

const DENY_EXAMPLES = [
  { value: 'Bash(git push:*)', label: 'Never push' },
  { value: 'Bash(rm -rf:*)', label: 'Never rm -rf' },
  { value: 'Read(./.env)', label: 'Never read .env' },
  { value: 'WebFetch', label: 'No web access' }
]

export function PermissionsSection() {
  const agent = useSettingsStore((s) => s.settings.agent)
  const update = useSettingsStore((s) => s.update)
  const openSettings = useLayoutStore((s) => s.openSettings)
  const policy = PERMISSION_POLICIES.find((p) => p.id === agent.defaultPermission)

  return (
    <div>
      <SectionHeader
        title="Permissions"
        description="Fine-grained rules on top of the permission policy. Rules use Claude Code syntax and apply to every chat in every project."
      />

      <SettingGroup flush>
        <Searchable terms="permission policy default ask accept auto yolo">
          <div className="mb-4 flex items-center gap-3 rounded-lg border border-line bg-panel px-4 py-3">
            <Info size={15} className="shrink-0 text-info" />
            <div className="min-w-0 flex-1 text-[12.5px] text-muted">
              Default policy for new chats: <span className={policy?.danger ? 'font-medium text-danger' : 'font-medium text-fg'}>{policy?.label ?? agent.defaultPermission}</span>.
              Deny rules always win over allow rules; “Always allow” in a permission prompt saves to the project’s <code className="font-mono text-[11px]">.claude/settings.local.json</code>.
            </div>
            <button type="button" className="shrink-0 text-[12px] font-medium text-accent hover:underline" onClick={() => openSettings('agent')}>
              Change policy
            </button>
          </div>
        </Searchable>
      </SettingGroup>

      <SettingGroup title="Allowed tools">
        <SettingRow
          label="Always allow"
          keywords="allow allowed tools rules permissions bash webfetch read"
          badge={
            <Badge tone="success">
              <ShieldCheck size={10} /> {agent.allowedTools.length}
            </Badge>
          }
          description="Matching tool calls run without asking. Use a trailing :* for prefix matches."
          stacked
        >
          <ListEditor
            items={agent.allowedTools}
            onChange={(items) => void update({ agent: { allowedTools: items } })}
            placeholder="Bash(npm test:*)"
            validate={validatePermissionRule}
            examples={ALLOW_EXAMPLES}
            tone="success"
            emptyText="No extra allow rules — ATOM asks according to the permission policy."
          />
        </SettingRow>
      </SettingGroup>

      <SettingGroup title="Disallowed tools">
        <SettingRow
          label="Never allow"
          keywords="deny disallowed blocked tools rules permissions"
          badge={
            <Badge tone="danger">
              <ShieldAlert size={10} /> {agent.disallowedTools.length}
            </Badge>
          }
          description="Matching tool calls are always refused, even in Full auto. A bare tool name removes the tool entirely."
          stacked
        >
          <ListEditor
            items={agent.disallowedTools}
            onChange={(items) => void update({ agent: { disallowedTools: items } })}
            placeholder="Bash(git push:*)"
            validate={validatePermissionRule}
            examples={DENY_EXAMPLES}
            tone="danger"
            emptyText="Nothing is blocked."
          />
        </SettingRow>
      </SettingGroup>

      <SettingGroup flush>
        <Searchable terms="rule syntax examples help pattern">
          <div className="rounded-lg border border-line bg-panel px-4 py-3 text-[12px] leading-relaxed text-muted">
            <div className="mb-1.5 font-medium text-fg">Rule syntax</div>
            <ul className="space-y-1">
              <li>
                <code className="font-mono text-[11.5px] text-fg">Bash(npm run build)</code> — exact command; <code className="font-mono text-[11.5px] text-fg">Bash(npm test:*)</code> — any command starting
                with <span className="font-mono">npm test</span>
              </li>
              <li>
                <code className="font-mono text-[11.5px] text-fg">Read(./src/**)</code>, <code className="font-mono text-[11.5px] text-fg">Edit(./docs/*.md)</code> — gitignore-style paths relative to the
                project
              </li>
              <li>
                <code className="font-mono text-[11.5px] text-fg">WebFetch(domain:example.com)</code> — a single domain; <code className="font-mono text-[11.5px] text-fg">mcp__github</code> — every tool of an
                MCP server
              </li>
            </ul>
          </div>
        </Searchable>
      </SettingGroup>
    </div>
  )
}
