---
description: Explain a file, symbol, path:line or the current editor selection - purpose, flow, key decisions and gotchas with clickable references
argument-hint: "[file | symbol | path:line | question] (blank = current selection)"
---

Explain code so the user understands what it does, how it works and what to watch out for. This is read-only:
do not edit files or run commands that change anything.

What to explain: $ARGUMENTS

## 1. Find the target

- A file path, `path:line` or `path:start-end` → Read it.
- A symbol name → Grep for its definition with word boundaries (`\bcreateSession\b`, `def create_session`,
  `func CreateSession`, `fn create_session`). If several definitions match, pick the most likely and say which
  one, or ask with AskUserQuestion when the choice matters.
- A question ("how does auth refresh work?") → find the code that answers it; for broad questions delegate the
  search to the `atom:explorer` subagent with the Agent tool and read the files it points to.
- Empty → use `mcp__atom-ide__get_selection` for the user's current selection; if nothing is selected, use
  `mcp__atom-ide__get_open_editors` and explain the active file (or the region around the cursor if it is large).

## 2. Build real understanding before writing

- Read the target and enough surrounding code to know its inputs and outputs.
- Follow the flow one hop in each direction: Grep for callers (who uses it, with what arguments) and read the
  callees that matter (what it delegates to).
- Read its tests - they are the best documentation of intended behaviour and edge cases.
- For "why is it like this?", check history: `git log --oneline -n 10 -- <file>`, `git log -L <start>,<end>:<file>`
  for the evolution of a specific range, and `git blame -L <start>,<end> <file>` to find the commit that
  introduced a line; then `git show <sha>` for the reasoning in its message.
- Note configuration, environment variables and feature flags that change its behaviour.

Base every claim on code you read. When you infer intent that the code does not state, label it as inference.

## 3. Write the explanation

Use this structure, scaled to the size of the target (a three-line function needs three sentences, not five
headings):

```markdown
**TL;DR** — <one or two sentences: what it is for and when it runs>

### Purpose
<the problem it solves and who calls it — path:line of the main callers>

### How it works
1. <step> — path:line
2. <step> — path:line
3. ...

### Key decisions
- <a non-obvious choice and its reason, from comments, commit history or evident constraints; mark inferences>

### Gotchas
- <edge cases, error behaviour, side effects, concurrency, performance traps, surprising defaults>

### Related
- <tests, sibling implementations, config, docs — with paths>
```

Guidelines:

- Cite code as `path:line` (or `path:start-end`) - ATOM makes these clickable. Quote only the few lines that
  carry the point.
- Explain at the level of the code's design: data flow, responsibilities, invariants. Do not narrate the code
  line by line.
- A small Mermaid sequence or flow diagram helps when three or more components interact.
- If the user asked a specific question, answer it first, then add context.
- If you notice a probable bug while explaining, mention it under Gotchas with evidence, but do not fix it
  unless asked.
