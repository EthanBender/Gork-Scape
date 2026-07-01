#!/usr/bin/env bash
# scripts/autocommit.sh — Stop-hook: snapshot + auto-publish to the live site.
# Snapshots the working tree to a commit ONLY when it's green (smoke passes), then
# PUSHES it to origin/main so the live Cloudflare deploy (gorkscape.ca) tracks the
# game automatically.
#
# [owner-enabled 2026-07-01] Auto-push is ON (was deliberately manual before).
# A broken tree is still left UNcommitted and unpushed on purpose, so ONLY green,
# booting work ever reaches the public site. The push is non-fatal: without cached
# git credentials (a one-time `gh auth login`) it just logs and retries next turn.
#
# Wired as a Stop hook in .claude/settings.json — runs each time the agent
# finishes a turn. Safe to run by hand too.
set -u

cd "$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0

publish() {
  # Push current tip to origin/main. On rejection (origin moved), reconcile once
  # and retry. Never fatal — deferred commits ship on a later turn.
  if git push --no-verify -q origin HEAD:main 2>/dev/null; then
    echo "autocommit: pushed -> live (gorkscape.ca)"
  else
    git pull --rebase --autostash -q origin main 2>/dev/null \
      && git push --no-verify -q origin HEAD:main 2>/dev/null \
      && echo "autocommit: reconciled + pushed -> live" \
      || echo "autocommit: push deferred (needs 'gh auth login' or a conflict) — retries next turn."
  fi
}

# Nothing changed this turn? Still try to ship any commits waiting from before.
if [ -z "$(git status --porcelain)" ]; then
  publish
  exit 0
fi

# Green gate: only snapshot/publish a tree that boots (syntax + import/export ok).
# On failure, skip the commit (don't block the Stop) and leave the tree dirty so
# the problem is visible and fixable next turn — and DON'T publish a broken tree.
if ! node scripts/smoke.mjs >/dev/null 2>&1; then
  echo "autocommit: smoke check FAILED — leaving changes uncommitted (fix, then they'll snapshot next turn)."
  exit 0
fi

git add -A
# --no-verify: don't re-trigger other hooks; keep this fast and self-contained.
git commit --no-verify -q -m "auto: green snapshot $(date -u +%Y-%m-%dT%H:%MZ)" >/dev/null 2>&1 \
  && echo "autocommit: snapshotted green tree -> $(git rev-parse --short HEAD)" \
  || echo "autocommit: nothing new to commit."

publish
exit 0
