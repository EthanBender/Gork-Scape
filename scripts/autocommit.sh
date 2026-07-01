#!/usr/bin/env bash
# scripts/autocommit.sh — Stop-hook safety net.
# Snapshots the working tree to a commit ONLY when it's green (smoke passes), so
# a session's work can't be lost or clobbered in this shared multi-agent tree.
# It NEVER pushes (pushing is an outward step that stays a human decision) and it
# leaves a broken tree UNcommitted on purpose, so master-quality is preserved.
#
# Wired as a Stop hook in .claude/settings.json — runs each time the agent
# finishes a turn. Safe to run by hand too.
set -u

cd "$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0

# Nothing changed? Do nothing.
if [ -z "$(git status --porcelain)" ]; then
  exit 0
fi

# Green gate: only snapshot a tree that boots (syntax + import/export consistent).
# On failure, skip the commit (don't block the Stop) and leave the tree dirty so
# the problem is visible and fixable next turn.
if ! node scripts/smoke.mjs >/dev/null 2>&1; then
  echo "autocommit: smoke check FAILED — leaving changes uncommitted (fix, then they'll snapshot next turn)."
  exit 0
fi

git add -A
# --no-verify: don't re-trigger other hooks; keep this fast and self-contained.
git commit --no-verify -q -m "auto: green snapshot $(date -u +%Y-%m-%dT%H:%MZ)" >/dev/null 2>&1 \
  && echo "autocommit: snapshotted green tree -> $(git rev-parse --short HEAD)" \
  || echo "autocommit: nothing to commit."
exit 0
