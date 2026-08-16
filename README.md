# better-dsh

A user-level Supervisor for DeepSeek Harness Web Profiles.

## Install

Requirements: Node.js, npm or npx, and preferably pnpm.

    bash install.sh
    source ~/.zshrc
    rehash 2>/dev/null || true

The installer updates the user-owned profile at ~/.dsh/profiles/web, installs the official HTTP Fetch Provider, installs the dsh command into ~/.dsh/bin, and adds that directory to the shell PATH.

## Use

    dsh start
    dsh status
    dsh restart
    dsh stop
    dsh --profile web

The managed Web UI uses http://127.0.0.1:3080.

Set DSH_REAL_BIN to use a stable DSH executable instead of npx.

## Security

The Supervisor stays outside the DSH process so it can restart DSH safely. Review third-party packages before installing them. The HTTP Fetch Provider expands Host network access; keep the UI bound to localhost unless you understand the security implications.
