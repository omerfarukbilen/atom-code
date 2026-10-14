---
name: git-workflow
description: Safe, professional Git usage - inspecting status/diff/log, staging atomic commits, writing Conventional Commits messages, branching, choosing rebase vs merge, resolving merge or rebase conflicts, pushing, writing pull request descriptions, and recovering lost work with reflog. Use whenever you are about to commit, branch, rebase, merge, resolve conflicts, open a PR, or undo something in Git, and before running any destructive Git command.
---

# Git Workflow

Git is the user's safety net. Every command you run either preserves that net or cuts holes in it. This skill
gives you a repeatable way to read repository state, produce a clean history, and recover from mistakes without
ever losing someone's work.

## When to use

- Committing changes you made (only when the user asked you to commit, or the active command does).
- Creating or switching branches, syncing with the default branch, rebasing or merging.
- A merge, rebase, cherry-pick or stash pop stopped with conflicts.
- Writing a commit message or pull request description.
- Something "disappeared" (a commit, a branch, a stash) and needs to be recovered.

Do not use it for: GitHub/GitLab administration (branch protection, CI settings), or rewriting history that has
already been published to a shared branch. For the latter, stop and ask the user.

## Ground rules (and why)

1. **Look before you act.** Run `git status` before any state-changing command. Uncommitted work is the easiest
   thing to destroy and the hardest to get back - the reflog does not track the working tree.
2. **Destructive commands need explicit consent.** The commands below discard data or rewrite shared history.
   Explain what will be lost and ask the user (AskUserQuestion) before running them, unless they literally asked
   for that exact operation:
   - `git reset --hard`, `git checkout -- <path>` / `git checkout .`, `git restore <path>` (without `--staged`)
   - `git clean -f` / `-fd` / `-fdx` (deletes untracked files permanently - preview with `git clean -nd` first)
   - `git push --force` / `-f`, `git push --delete`, `git branch -D`, `git stash drop` / `git stash clear`
   - `git rebase`, `git commit --amend`, `git filter-repo` on commits that exist on a remote branch others use
3. **Make a cheap backup before risky operations.** `git branch backup/$(git branch --show-current)-pre-rebase`
   costs nothing and turns a scary rebase into an undoable one. Delete it once the user is happy.
4. **Never force-push a shared branch** (`main`, `master`, `develop`, release branches, or a teammate's branch).
   On your own feature branch after a rebase, use `git push --force-with-lease` - it refuses to overwrite commits you
   have not seen, which plain `--force` silently destroys.
5. **Do not change Git configuration** (`git config`, hooks, `.gitattributes`) unless asked, and do not bypass
   hooks with `--no-verify`. Hooks encode the team's quality gate; if a hook fails, fix the cause.
6. **Avoid interactive commands.** You cannot drive an editor or a pager prompt. Use non-interactive forms:
   `git commit -F -` with a heredoc, `GIT_EDITOR=true git rebase --continue`, `git --no-pager log`,
   `GIT_SEQUENCE_EDITOR=: git rebase -i --autosquash <base>` (the no-op editor accepts the generated todo list).
   Never use `git add -p` or `git add -i`.
7. **Commit and push only when asked.** Making changes is the task; publishing them is the user's decision.

## Step 1 - Inspect the repository

Run these in parallel (they are read-only) and read the output before deciding anything:

```bash
git status --short --branch          # branch, ahead/behind, staged (left col) vs unstaged (right col)
git --no-pager diff --stat           # unstaged changes, summarized
git --no-pager diff --staged --stat  # what the next commit will contain
git --no-pager log --oneline --graph --decorate -n 20
git branch -vv                       # local branches and their upstreams
git stash list
```

What to look for:

- **An operation in progress.** `git status` says "You are currently rebasing/merging/cherry-picking". Finish or
  abort it before doing anything else (see Step 6).
- **Detached HEAD.** Commits made here are easy to lose. Create a branch first: `git switch -c <name>`.
- **Unrelated changes in the working tree.** The user may have their own edits in progress. Never stage, stash or
  discard files you did not touch without asking.
- **The repo's commit conventions.** Skim `git log --oneline -n 30`, and check for `commitlint.config.*`,
  `.czrc`, `CONTRIBUTING.md` or a PR template (`.github/pull_request_template.md`). Match what the project does -
  local convention beats this skill's defaults.

Use `git --no-pager diff` (full) or Read on specific files to understand the actual change before you describe it.
ATOM may also attach the current diff in the `<git_diff>` block of the user's message.

## Step 2 - Stage atomic commits

An atomic commit contains one logical change that builds and passes tests on its own. Atomic history makes review,
`git bisect`, `git revert` and cherry-picking work; a single "misc changes" commit defeats all four.

- Stage explicit paths: `git add src/auth/session.ts src/auth/session.test.ts`. Avoid `git add -A` / `git add .`
  unless you have just verified every file in `git status` belongs in the commit.
- Keep refactors, formatting churn and behavior changes in separate commits. A reviewer should be able to read a
  "refactor:" commit knowing nothing behaves differently.
- Tests go in the same commit as the code they test.
- Before committing, review what is staged: `git --no-pager diff --staged`. Check for debug prints, commented-out
  code, `.env` files, credentials, large binaries, lockfile changes you did not intend, and generated build output.
- If one file mixes two concerns and splitting matters, write the subset as a patch and apply it to the index:
  `git --no-pager diff src/x.ts > /tmp/x.patch`, edit the patch, then `git apply --cached /tmp/x.patch`. Usually it
  is simpler to commit the file with the larger concern and mention the small one in the body.

## Step 3 - Write the commit message

Default to [Conventional Commits](https://www.conventionalcommits.org/) unless the repo uses another style.
Full type list and many examples: [references/conventional-commits.md](references/conventional-commits.md).

```
<type>(<optional scope>): <imperative summary, lower case, no trailing period, <= 72 chars>

<body: why the change was needed and what approach was taken; wrap at ~72 columns>

<footers: BREAKING CHANGE: ..., Refs: #123, Co-authored-by: ...>
```

Common types: `feat`, `fix`, `refactor`, `perf`, `test`, `docs`, `build`, `ci`, `chore`, `style`, `revert`.
Mark breaking changes with `!` after the type/scope and a `BREAKING CHANGE:` footer.

| Bad | Why it is bad | Good |
| --- | --- | --- |
| `fixed stuff` | No type, no information | `fix(auth): refresh token before it expires` |
| `feat: Added the new export button.` | Past tense, capitalized, trailing period | `feat(reports): add CSV export button` |
| `update user.ts` | Describes the file, not the change | `refactor(user): extract address validation` |
| `fix: fix bug where app crashes sometimes when you click save quickly twice in a row on slow networks` | Summary is a paragraph | `fix(editor): ignore duplicate save while request is in flight` |

Commit non-interactively with a heredoc so newlines and quotes survive:

```bash
git commit -F - <<'EOF'
fix(api): return 404 instead of 500 for unknown project id

getProject() threw on a missing row and the error middleware mapped every
unknown exception to 500. Return null from the repository and translate it
to a 404 problem response in the handler.

Refs: #482
EOF
```

If a pre-commit hook rewrites files (formatters), re-stage them and commit again - do not reach for `--no-verify`.
If the hook fails on a real problem, fix it, then create a new commit rather than amending someone else's commit.

## Step 4 - Branch

```bash
git fetch origin
git switch -c feat/csv-export origin/main     # branch from the up-to-date remote default branch
```

- Name branches `<type>/<short-kebab-description>` (e.g. `fix/token-refresh-race`), or follow the repo's scheme
  (ticket IDs like `ABC-123-token-refresh`).
- Find the default branch instead of assuming `main`:
  `git symbolic-ref --short refs/remotes/origin/HEAD` (prints `origin/main`).
- One branch per unit of reviewable work. Long-lived branches accumulate conflicts; integrate early.

## Step 5 - Rebase or merge?

| Situation | Use | Reason |
| --- | --- | --- |
| Update your own unpublished (or solo) feature branch with new `main` commits | `git rebase origin/main` | Linear history, conflicts resolved commit by commit |
| Branch is shared with others, or already reviewed and others pulled it | `git merge origin/main` | Rebasing rewrites commits others have built on |
| Integrate a finished feature into `main` | The repo's PR policy (squash, merge commit, or rebase-merge) | Follow the project's convention |
| Clean up your own WIP commits before review | `git commit --fixup <sha>` then `GIT_SEQUENCE_EDITOR=: git rebase -i --autosquash origin/main` | Non-interactive squash of fixups |
| Bring one specific commit to another branch | `git cherry-pick -x <sha>` | `-x` records where it came from |

The golden rule: rebase only commits that exist solely on your machine or solely on your own branch. If unsure
whether anyone else uses the branch, merge - it is never wrong, just less tidy.

Prefer `git pull --rebase` (or `--ff-only`) over a bare `git pull` on your feature branch so you do not create
accidental merge commits; do not change the user's `pull.rebase` config to achieve it.

## Step 6 - Resolve conflicts carefully

A conflict means two people changed the same thing for possibly different reasons. Resolving it means producing
code that honors both intents - not picking whichever side makes the markers go away.

1. **See what is conflicted:** `git status` and `git --no-pager diff --name-only --diff-filter=U`.
2. **Understand both sides before editing.** Read the whole conflicted file. Then learn why each side changed:
   - Merge: `git --no-pager log --merge -p -- <file>` shows the commits on both sides touching the file.
   - Rebase: `git --no-pager log -p -n 5 origin/main -- <file>` for upstream, and the commit being replayed is
     shown by `git --no-pager show REBASE_HEAD`.
   - Remember: during a **rebase**, "ours" is the branch you are rebasing onto (upstream) and "theirs" is your
     commit being replayed - the reverse of a merge.
3. **Edit to the combined intent.** If upstream renamed a function you also modified, apply your modification to the
   renamed function. Use `git checkout --ours <file>` / `--theirs <file>` only when one side is wholly correct for
   the whole file (e.g. a regenerated lockfile - and then regenerate it with the package manager instead).
4. **Prove no markers remain:** use Grep with pattern `^(<<<<<<<|=======|>>>>>>>)( |$)` over the conflicted files.
5. **Verify it builds and tests pass** before continuing. Check `mcp__atom-ide__get_diagnostics` for type errors in
   the files you touched, then run the relevant tests. A conflict resolution that compiles is not necessarily correct.
6. **Continue:** `git add <files>` then `GIT_EDITOR=true git rebase --continue` (or `git commit --no-edit` for a
   merge, `GIT_EDITOR=true git cherry-pick --continue` for a cherry-pick).
7. **Bail out if it goes wrong:** `git rebase --abort` / `git merge --abort` / `git cherry-pick --abort` restores the
   pre-operation state. Aborting is always better than a guessed resolution. If a conflict needs product knowledge
   you do not have, stop and ask the user which behavior they want.

Lockfiles (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `Cargo.lock`, `poetry.lock`, `go.sum`): take one
side, then regenerate with the tool (`npm install`, `pnpm install`, `cargo generate-lockfile` or `cargo update -p`,
`poetry lock`, `go mod tidy`) - only if the user allows installs; otherwise tell them it is required.

## Step 7 - Push and open a pull request

```bash
git push -u origin HEAD                         # first push, sets upstream
git push --force-with-lease --force-if-includes # only after rebasing YOUR OWN branch
```

Self-review the full branch diff first (the `atom:code-review` process) - fixing a problem before the PR is
cheaper than in review. Then write the description from [templates/pull-request.md](templates/pull-request.md):
what changed, why, how it was tested, risks, and screenshots for UI work. Base it on the full branch diff (`git --no-pager diff origin/main...HEAD`
and `git --no-pager log origin/main..HEAD`), not just the last commit. If the repo has its own PR template, use that.

With the GitHub CLI:

```bash
gh pr create --base main --title "feat(reports): add CSV export" --body-file /tmp/pr-body.md
gh pr create --draft ...    # when work is not ready for review
```

Keep PRs small (a few hundred changed lines when possible). If a PR does three things, suggest splitting it.

## Step 8 - Recover with reflog

Almost nothing committed is ever truly lost for ~90 days: the reflog records every position `HEAD` and each branch
has had. Detailed recipes: [references/recovery.md](references/recovery.md).

```bash
git --no-pager reflog -n 30                      # find the state you want, e.g. HEAD@{5} or abc1234
git branch rescue/before-bad-rebase abc1234      # safest: point a new branch at it, then inspect
git --no-pager log --oneline -n 5 rescue/before-bad-rebase
```

Prefer creating a rescue branch over `git reset --hard` - it changes nothing until you have confirmed the commit is
the right one. To undo a commit that is already pushed to a shared branch, use `git revert <sha>`, which adds a new
commit instead of rewriting history.

## Common pitfalls

- Running `git stash` to "get changes out of the way" and forgetting to `git stash pop`. Prefer committing WIP on a
  branch; if you stash, use `git stash push -m "atom: <reason>"` and tell the user.
- `git checkout <file>` to "see the old version" - it overwrites the working copy. Use
  `git --no-pager show HEAD:<path>` instead.
- Amending a commit that was already pushed, then pushing with `--force` to a shared branch.
- Resolving a conflict by deleting the other side's change because it was "in the way".
- Writing the commit message from the task description instead of from the actual staged diff.
- Committing generated files, secrets, or `node_modules/` because `.gitignore` was incomplete - fix `.gitignore`
  (with the user's approval) and `git rm --cached` the file.
- Assuming the default branch is `main`, or that `origin` is the only remote.

## Definition of done

- [ ] `git status` is clean, or the remaining changes are intentionally left (and you said so).
- [ ] Each commit is one logical change, with a message that matches the repo's convention and explains why.
- [ ] No conflict markers, secrets, debug output or unintended files were committed.
- [ ] Build/tests were run after any conflict resolution or history rewrite.
- [ ] Nothing was force-pushed to a shared branch; every destructive command had the user's consent.
- [ ] You reported the resulting state: branch name, commits created (`git --no-pager log --oneline origin/main..HEAD`),
      and whether anything was pushed.
