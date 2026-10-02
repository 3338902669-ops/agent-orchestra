#!/usr/bin/env sh
# One-click installer for the agent-orchestra skill.
#
# Usage: ./scripts/install.sh [-t <skill-dir>] [-m full|light] [-f]
#
#   full  (default) SKILL.md, references, config, scripts, bench, examples - the checks the skill
#                    refers to actually work, so the gate can run where it was installed.
#   light           SKILL.md, references, config only: the prompt-level skill, no runnable checks.
set -e
TARGET=""
FORCE=0
MODE="full"
while getopts "t:m:f" opt; do
  case "$opt" in
    t) TARGET="$OPTARG" ;;
    m) MODE="$OPTARG" ;;
    f) FORCE=1 ;;
  esac
done
case "$MODE" in full|light) ;; *) echo "-m must be full or light" >&2; exit 1 ;; esac
REPO="$(cd "$(dirname "$0")/.." && pwd)"
if [ -z "$TARGET" ]; then
  # Set AGENT_SKILLS_DIR for your host, or pass -t explicitly.
  for c in "$AGENT_SKILLS_DIR" "$HOME/.claude/skills" "$HOME/.agents/skills"; do
    if [ -d "$c" ]; then TARGET="$c/agent-orchestra"; break; fi
  done
fi
if [ -z "$TARGET" ]; then
  echo "No skill directory detected. Pass -t <path> explicitly." >&2
  exit 1
fi
# The target usually does not exist on a first install, and copying into a missing directory fails.
mkdir -p "$TARGET"
if [ "$MODE" = "full" ]; then
  ITEMS="SKILL.md references config scripts bench examples"
else
  ITEMS="SKILL.md references config"
fi
for item in $ITEMS; do
  src="$REPO/$item"
  dst="$TARGET/$item"
  if [ ! -e "$src" ]; then echo "Missing: $src" >&2; exit 1; fi
  if [ -e "$dst" ] && [ "$FORCE" -ne 1 ]; then echo "Exists (use -f): $dst" >&2; continue; fi
  cp -R "$src" "$dst"
  COPIED="${COPIED:-} $item"
done
echo "Installed${COPIED:- nothing} to $TARGET [$MODE]"
# Smoke check: an install that cannot run the checks it documents is not an install.
if [ "$MODE" = "full" ]; then
  if [ ! -e "$TARGET/scripts/check-handoff.mjs" ]; then
    echo "Smoke check FAILED: scripts/check-handoff.mjs is not present" >&2
    exit 1
  fi
  if command -v node >/dev/null 2>&1; then
    if node "$TARGET/scripts/check-handoff.mjs" --dir "$TARGET/examples/handoff" >/dev/null; then
      echo "Smoke check passed: the installed checks run"
    else
      echo "Smoke check FAILED: check-handoff.mjs rejected the shipped example" >&2
      exit 1
    fi
  else
    echo "node not found: skipped the smoke check (install is still complete)"
  fi
else
  echo "Light mode: no runnable checks installed (use -m full)"
fi
