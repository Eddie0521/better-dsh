#!/usr/bin/env bash
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
PROFILE_NAME="${DSH_PROFILE:-web}"
PROFILE_DIR="$DSH_HOME/profiles/$PROFILE_NAME"
PROFILE_PACKAGE="$PROFILE_DIR/package.json"
BIN_DIR="$DSH_HOME/bin"
command -v node >/dev/null 2>&1 || { echo "Node.js is required" >&2; exit 1; }
mkdir -p "$PROFILE_DIR" "$BIN_DIR"
# Fresh profile: scaffold package.json (the profile's own patch layer stays
# as-is on existing profiles — install.sh never rewrites user state).
if [ ! -f "$PROFILE_PACKAGE" ]; then
  cat > "$PROFILE_PACKAGE" <<'JSON'
{"name":"dsh-profile-web","private":true,"dsh":{"profile":{"bundles":["@deepseek-ai/dsh-base","@deepseek-ai/dsh-web-app"]}},"dependencies":{}}
JSON
fi

cp "$REPO_ROOT/lib/dsh-supervisor.sh" "$BIN_DIR/dsh-supervisor.sh"; cp "$REPO_ROOT/bin/dsh" "$BIN_DIR/dsh"; chmod +x "$BIN_DIR/dsh" "$BIN_DIR/dsh-supervisor.sh"
if command -v pnpm >/dev/null 2>&1; then (cd "$PROFILE_DIR" && pnpm install); else echo "pnpm is not installed; run pnpm install in $PROFILE_DIR" >&2; fi
PATH_LINE='export PATH="$HOME/.dsh/bin:$PATH"'; for rc in "$HOME/.zshrc" "$HOME/.bashrc"; do touch "$rc"; grep -Fq "$PATH_LINE" "$rc" || printf '\n# better-dsh\n%s\n' "$PATH_LINE" >> "$rc"; done
echo "better-dsh installed; open a new terminal, then use dsh start or dsh restart"
