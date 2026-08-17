<h4 align="right"><strong>English</strong> | <a href="README_CN.md">简体中文</a></h4>

<p align="center">
  <img src="assets/deepseek.svg" alt="DeepSeek" width="138" />
</p>

<h1 align="center">better-dsh</h1>

<p align="center"><strong>Run DeepSeek Harness Web as a managed background service</strong></p>

<p align="center">
  A user-level supervisor for <a href="https://github.com/deepseek-ai/deepseek-harness">DeepSeek Harness</a> Web Profiles.
</p>

## Features

- 🚀 **One-command start**: `dsh start` launches the Web UI at `http://127.0.0.1:3080` in the background, with `status`, `restart`, and `stop`.
- ⚡ **One-command install**: `install.sh` creates your user-owned Web profile and puts `dsh` on your PATH.
- 🔄 **Restart from any side**: `dsh restart` is a detached restart — it returns immediately, a setsid worker bounces the server, and the outcome lands in a result file. Safe whether you run it in a terminal or an agent does (the browser session reconnects on its own).
- 🏠 **No sudo required**: Everything installs under `~/.dsh`; no root access or system services.
- 🔒 **Local only**: The managed UI binds to `127.0.0.1` on your machine.

## Install

Requirements: Node.js, npm or npx, and preferably pnpm.

```bash
git clone https://github.com/Eddie0521/better-dsh.git
cd better-dsh
bash install.sh
source ~/.zshrc
rehash 2>/dev/null || true
```

The installer updates your user-owned profile and installs:

```text
~/.dsh/profiles/web    # managed Web profile
~/.dsh/bin/dsh         # the dsh command (supervisor + official CLI dispatcher)
```

No password is needed. Open a new terminal after installing.

## Usage

```bash
dsh start
dsh status
dsh restart
dsh stop
```

- The managed Web UI is available at `http://127.0.0.1:3080`.
- The profile defaults to `web`; switch it with `dsh --profile <name>` or the `DSH_PROFILE` environment variable.
- Set `DSH_REAL_BIN` to a stable DSH executable to skip the `npx` lookup.
- Logs and the PID file live in `~/.dsh/profiles/web/`.

### The `dsh` dispatcher

`dsh` is a thin dispatcher: `start` / `stop` / `restart` / `status` go to the
supervisor; **everything else passes through to the official DeepSeek Harness
CLI**, so `dsh web`, `dsh plugin …` and `dsh --profile <name>` all keep
working.

The supervisor tracks the process on the profile's port (default `3080`), not
just its own PID file: `dsh status` reports a manually started server as
`running (not supervised)`, `dsh start` adopts it, and `dsh stop` stops it.

## Development

```bash
bash lib/dsh-supervisor.sh status   # run the supervisor directly
```

- `bin/dsh` is the entry point; the supervisor logic lives in `lib/dsh-supervisor.sh`.
- `dsh restart` is detached: it returns immediately, a setsid worker bounces
  the server, and the outcome lands in `~/.dsh/profiles/<name>/dsh-restart-detached.result`
  (`dsh restart-sync` keeps the old blocking form for scripts).
- The supervisor deletes `cordis.yml` before starting so the booting process
  creates it fresh — avoids macOS provenance (EPERM) conflicts between
  processes started from different terminals/agents.

## License

[MIT](LICENSE). DeepSeek Harness and its assets retain their respective upstream licenses and trademarks.
