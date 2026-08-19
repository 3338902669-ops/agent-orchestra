#!/usr/bin/env sh
# One-click installer for the multi-agent-orchestration skill.
# Usage: ./scripts/install.sh [-t <skill-dir>] [-f]
set -e
TARGET=""
FORCE=0
while getopts "t:f" opt; do
  case "$opt" in
    t) TARGET="$OPTARG" ;;
    f) FORCE=1 ;;
  esac
done
REPO="$(cd "$(dirname "$0")/.." && pwd)"
if [ -z "$TARGET" ]; then
  for c in "$HOME/.claude/skills" "$HOME/.agents/skills" "$HOME/.dsh/skills"; do
    if [ -d "$c" ]; then TARGET="$c/multi-agent-orchestration"; break; fi
  done
fi
if [ -z "$TARGET" ]; then
  echo "No skill directory detected. Pass -t <path> explicitly." >&2
  exit 1
fi
for item in SKILL.md references config; do
  src="$REPO/$item"
  dst="$TARGET/$item"
  if [ ! -e "$src" ]; then echo "Missing: $src" >&2; exit 1; fi
  if [ -e "$dst" ] && [ "$FORCE" -ne 1 ]; then echo "Exists (use -f): $dst" >&2; continue; fi
  cp -R "$src" "$dst"
done
echo "Installed to $TARGET"
