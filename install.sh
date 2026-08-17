#!/usr/bin/env bash
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
PROFILE_NAME="${DSH_PROFILE:-web}"
PROFILE_DIR="$DSH_HOME/profiles/$PROFILE_NAME"
PROFILE_PACKAGE="$PROFILE_DIR/package.json"
PATCH_FILE="$PROFILE_DIR/cordis.patch.yml"
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

# Local plugin packages (plugins/<name>): build when needed, link into the
# profile's package.json, and mount each as a cordis loader entry. A plugin
# with a `.disabled` marker in its directory is skipped (local opt-out; the
# marker is gitignored).
ensure_plugin() {
  local dir="$1" name
  [ ! -f "$dir/.disabled" ] || { echo "skip $dir: disabled (.disabled marker)" >&2; return 0; }
  name="$(node -e "console.log(require(process.argv[1]).name)" "$dir/package.json" 2>/dev/null || true)"
  [ -n "$name" ] || { echo "skip $dir: no package.json name" >&2; return 0; }
  if [ ! -f "$dir/lib/client.js" ]; then
    if command -v pnpm >/dev/null 2>&1; then
      (cd "$dir" && pnpm install && pnpm build) || { echo "failed to build plugin $name (plugins/$(basename "$dir"))" >&2; return 1; }
    else
      echo "pnpm is required to build plugin $name (plugins/$(basename "$dir")); run pnpm install && pnpm build there" >&2; return 1
    fi
  fi
  node - "$PROFILE_PACKAGE" "$dir" "$name" <<'NODE'
const fs = require('fs'); const [p, dir, name] = process.argv.slice(2);
const d = JSON.parse(fs.readFileSync(p, 'utf8'));
d.dependencies = d.dependencies || {};
d.dependencies[name] = `link:${dir}`;
fs.writeFileSync(p, JSON.stringify(d, null, 2) + '\n');
NODE
  # A plugin must have exactly one mount source. Bundle-managed plugins are
  # already inserted by the bundle layer; remove any stale profile insert —
  # including the full continuation block (config, disabled, nested insert
  # children, etc.) so no orphaned YAML fragments are left behind.
  node - "$PROFILE_PACKAGE" "$PATCH_FILE" "$name" <<'NODE'
const fs = require('fs');
const [packageFile, patchFile, name] = process.argv.slice(2);
const profile = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
const bundles = profile.dsh?.profile?.bundles || [];
let patch = fs.existsSync(patchFile) ? fs.readFileSync(patchFile, 'utf8') : '';

// Line-by-line removal of every entry whose id matches. A regex that only
// strips the id+name lines leaves orphaned config/disabled fields behind;
// scanning indentation boundaries catches the whole entry block.
const lines = patch.split('\n');
const kept = [];
let skip = false;
let skipIndent = 0;
for (const line of lines) {
  const m = line.match(/^(\s*)-\s*id:\s*[\x22\x27]?(.+?)[\x22\x27]?\s*$/);
  if (m && m[2] === name) {
    skip = true;
    skipIndent = m[1].length;
    continue;
  }
  if (skip) {
    if (line.trim() === '') continue;
    const ind = (line.match(/^(\s*)/) || ['', ''])[1].length;
    if (ind > skipIndent) continue;
    skip = false;
  }
  if (!skip) kept.push(line);
}
patch = kept.join('\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '').replace(/\n+$/, '\n');

// Only mount via the manual channel when the plugin is NOT bundle-managed
// (bundle-managed plugins are mounted by their own cordis.patch.yml).
if (!bundles.includes(name)) {
  if (!patch.includes(`- id: ${name}`)) {
    if (patch && !patch.endsWith('\n')) patch += '\n';
    patch += `  - id: ${name}\n    name: '${name}'\n`;
  }
}
fs.writeFileSync(patchFile, patch);
NODE
}
if [ -d "$REPO_ROOT/plugins" ]; then
  for plugin_dir in "$REPO_ROOT"/plugins/*/; do
    [ -d "$plugin_dir" ] && [ -f "$plugin_dir/package.json" ] && ensure_plugin "${plugin_dir%/}"
  done
fi

cp "$REPO_ROOT/lib/dsh-supervisor.sh" "$BIN_DIR/dsh-supervisor.sh"; cp "$REPO_ROOT/bin/dsh" "$BIN_DIR/dsh"; chmod +x "$BIN_DIR/dsh" "$BIN_DIR/dsh-supervisor.sh"
if command -v pnpm >/dev/null 2>&1; then (cd "$PROFILE_DIR" && pnpm install); else echo "pnpm is not installed; run pnpm install in $PROFILE_DIR" >&2; fi
PATH_LINE='export PATH="$HOME/.dsh/bin:$PATH"'; for rc in "$HOME/.zshrc" "$HOME/.bashrc"; do touch "$rc"; grep -Fq "$PATH_LINE" "$rc" || printf '\n# better-dsh\n%s\n' "$PATH_LINE" >> "$rc"; done
echo "better-dsh installed; open a new terminal, then use dsh start or dsh restart"
