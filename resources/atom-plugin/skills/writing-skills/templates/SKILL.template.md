---
name: skill-name
description: One-line capability summary - the main actions and the domain they apply to. Use when the user asks to do X, mentions Y or Z, works with .ext files, or sees an error such as ABC. Not for Q - use other-skill instead.
---

<!--
  Template from atom:writing-skills. Copy this folder layout:
    skill-name/
      SKILL.md              (this file - rename from SKILL.template.md)
      references/*.md       (optional: long, situational material)
      templates/*           (optional: output skeletons the agent fills in)
      scripts/*             (optional: deterministic helpers the agent runs)

  Frontmatter rules:
    - name: kebab-case, identical to the directory name, at most 64 characters.
    - description: what it does + when to use it, with words users actually say. Under ~600 characters,
      hard limit 1024, no angle brackets. This is the ONLY text the model sees before loading the skill.

  Body guidance: 100-300 lines. Assume a capable reader; spend words on what is specific or easy to get
  wrong. Give the reason behind each rule. Delete every comment and any section that does not apply.
-->

# Skill Title

<!-- 2-4 sentences: what this skill achieves and the core idea or principle behind doing it well. -->
One-paragraph overview of the goal and the key insight that makes the difference between doing this well
and doing it badly.

## When to use

- Concrete situation or request that should trigger this skill.
- Another situation, phrased the way a user would say it.
- A signal in the code or output (file type, error message, tool) that means this applies.

## When not to use

- Near-miss situation that looks similar but needs something else - and what to use instead.
- Trivial case where following the full process is overkill.

## Process

<!-- Numbered steps. For multi-step work, suggest tracking them in TodoWrite. Each step: what to do, how
     (tools, commands), and why it matters in one clause. -->

### 1. First step

What to do and why. Name the tools: Read, Grep, Glob, Bash, Edit, Write, WebFetch, AskUserQuestion,
`mcp__atom-ide__get_diagnostics`, ...

```bash
# exact command(s), with per-ecosystem variants if relevant
```

### 2. Second step

Details. Link long material instead of inlining it: see [references/topic.md](references/topic.md) when
the situation is ... (say exactly when to read it).

### 3. Verify

How the agent proves the work is correct: the command to run, the property to check, the output to compare.

## Examples

```text
// Bad - why it is bad in one line
...

// Good - why it is better in one line
...
```

## Common pitfalls

- **Pitfall name.** What goes wrong and how to avoid it.
- **Pitfall name.** What goes wrong and how to avoid it.

## Definition of done

- [ ] Verifiable outcome 1 (a command passes, a file exists, a check holds).
- [ ] Verifiable outcome 2.
- [ ] Result reported to the user, including anything not done and why.
