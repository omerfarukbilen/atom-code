# Undo and recovery recipes

Read this when something needs to be undone or appears lost. First rule: **stop and inspect** - every extra
command you run in a panic can make recovery harder. Run `git status` and `git --no-pager reflog -n 30` first.

## What Git can and cannot recover

| Lost thing | Recoverable? | How |
| --- | --- | --- |
| A commit (reset away, rebased away, branch deleted) | Yes, for ~90 days (reflog expiry; 30 days for unreachable entries) | reflog, `git fsck` |
| A dropped or cleared stash | Usually, until garbage collection | `git fsck --unreachable` |
| Staged-but-never-committed content | Sometimes, as dangling blobs (file names are lost) | `git fsck --lost-found` |
| Unstaged working-tree edits overwritten by `checkout`/`reset --hard`/`restore` | No (Git never saw them) | Editor local history / ATOM checkpoints only |
| Untracked files removed by `git clean -f` | No | Backups only |

This table is why destructive commands need consent: the last two rows are unrecoverable by Git. In ATOM, file
checkpoints (when enabled) may restore edits the agent made, but never rely on that as a substitute for care.

## Recipes

Always prefer the **non-destructive** variant: point a new branch at the recovered commit, inspect it, and only
then move existing branches.

### Undo the last commit, keep the changes staged

```bash
git reset --soft HEAD~1
```

Use when the commit message was wrong or you committed too early. Only on commits that are not pushed (or are on
your own branch).

### Undo the last commit, keep the changes unstaged

```bash
git reset HEAD~1        # --mixed is the default
```

### Fix the last commit's message or add a forgotten file (unpushed only)

```bash
git add forgotten-file.ts
git commit --amend --no-edit               # keep message
git commit --amend -F - <<'EOF'            # replace message
fix(parser): handle trailing commas in arrays
EOF
```

### Undo a commit that is already pushed to a shared branch

```bash
git revert <sha>                 # creates a new commit that inverts <sha>
git revert -m 1 <merge-sha>      # reverting a merge commit: keep parent 1 (the mainline)
```

Never reset + force-push a shared branch to remove a commit; teammates who already pulled it will reintroduce it.

### Recover from a bad rebase, reset or amend

```bash
git --no-pager reflog -n 30
# e.g.  9f1c2ab HEAD@{7}: rebase (start): checkout origin/main
#       4d5e6f7 HEAD@{8}: commit: feat(api): add pagination   <- last good state
git branch rescue/pre-rebase 4d5e6f7
git --no-pager log --oneline -n 10 rescue/pre-rebase   # confirm it is what you want
git --no-pager diff HEAD rescue/pre-rebase --stat      # see what differs from now
```

Then, with the user's agreement and a clean working tree (`git status`), move the branch back:

```bash
git reset --hard rescue/pre-rebase
```

`ORIG_HEAD` also points to where `HEAD` was before the last reset, rebase or merge: `git branch rescue ORIG_HEAD`.

The branch-specific reflog is often easier to read than `HEAD`'s: `git --no-pager reflog show feat/my-branch`.

### Restore a deleted branch

```bash
git --no-pager reflog | grep -i "feat/csv-export" | head   # find its last commit
git branch feat/csv-export <sha>
```

If the branch was deleted with `git branch -D` the deletion output printed the sha: `Deleted branch x (was abc1234).`

### Recover a dropped stash

```bash
git fsck --unreachable --no-reflogs | grep commit | cut -d' ' -f3 \
  | xargs git --no-pager log --no-walk --oneline --grep="^WIP on" --grep="^On "
git stash apply <sha>          # or: git branch rescue/stash <sha>
```

Stash commits have messages starting with `WIP on <branch>` or `On <branch>: <message>`.

### Restore one file from another commit without touching anything else

```bash
git --no-pager show <sha>:path/to/file.ts            # view it first
git restore --source=<sha> -- path/to/file.ts        # overwrites the working copy of that file
```

`git restore --source` overwrites that file's uncommitted edits; check `git status` for it first.

### Unstage a file (keep the edits)

```bash
git restore --staged path/to/file
```

### Remove a file from Git but keep it on disk (e.g. committed `.env`)

```bash
git rm --cached .env
echo ".env" >> .gitignore      # with the user's approval
```

If the file contained secrets and was ever pushed, removing it is not enough: the secret is in history and must be
**rotated**. Rewriting history (`git filter-repo --path .env --invert-paths`) requires coordination with everyone
who has cloned the repository - recommend it to the user, do not do it unilaterally.

### Abort an in-progress operation

```bash
git merge --abort
git rebase --abort
git cherry-pick --abort
git revert --abort
git am --abort
```

### Find which commit introduced a bug

Bisect moves `HEAD`, so run it on a clean tree or - better - in a separate worktree as shown in
`atom:systematic-debugging` (its `references/techniques.md` has a robust repro script).

```bash
git bisect start
git bisect bad                 # current commit is broken
git bisect good v1.4.0         # last known good
git bisect run npm test        # automate: exit 0 = good, 125 = skip, 1-127 otherwise = bad
git bisect reset               # always finish with this
```

Atomic commits are what make bisect land on a small, understandable change.

## After recovering

- Tell the user exactly what was recovered and where it now lives (branch name, sha).
- Leave `rescue/*` branches in place until the user confirms; then `git branch -d rescue/...` (lower-case `-d`
  refuses to delete unmerged work, which is the safe default).
