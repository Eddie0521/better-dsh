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
- ⚡ **One-command install**: `install.sh` creates your user-owned Web profile, installs the official HTTP Fetch Provider, and puts `dsh` on your PATH.
- 🔄 **Safe restarts**: The supervisor lives outside the DSH process, so it can stop and restart DSH without killing itself.
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
~/.dsh/bin/dsh         # the dsh command
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

## Development

```bash
bash lib/dsh-supervisor.sh status   # run the supervisor directly
```

- `bin/dsh` is the entry point; all the logic lives in `lib/dsh-supervisor.sh`.
- The installer patches the profile's `cordis.patch.yml` to insert the HTTP Fetch Provider — review third-party packages before installing them.
- The HTTP Fetch Provider expands Host network access; keep the UI bound to localhost unless you understand the security implications.

## License

[MIT](LICENSE). DeepSeek Harness and its assets retain their respective upstream licenses and trademarks.
