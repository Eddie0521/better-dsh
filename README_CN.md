<h4 align="right"><a href="README.md">English</a> | <strong>简体中文</strong></h4>

<p align="center">
  <img src="assets/deepseek.svg" alt="DeepSeek" width="138" />
</p>

<h1 align="center">better-dsh</h1>

<p align="center"><strong>把 DeepSeek Harness Web 作为托管的后台服务运行</strong></p>

<p align="center">
  一个为 <a href="https://github.com/deepseek-ai/deepseek-harness">DeepSeek Harness</a> Web Profile 提供的用户级守护进程。
</p>

## 特性

- 🚀 **一条命令启动**：`dsh start` 在后台启动 Web UI（`http://127.0.0.1:3080`），并提供 `status`、`restart`、`stop`。
- ⚡ **一条命令安装**：`install.sh` 创建你的用户级 Web profile、自动构建并挂载 `plugins/` 下的插件，并把 `dsh` 加入 PATH。
- 🔄 **任意一侧都能重启**：`dsh restart` 是脱离式重启——立即返回，setsid 子进程完成弹跳，结果写入结果文件。终端执行或 agent 执行都安全（浏览器会话会自动重连）。
- 🔘 **界面一键重启**：`dsh-restart-button` 插件在侧边栏底部「设置」行右端放一个刷新按钮。任何来源的重启（按钮 / agent 的 `dsh_restart` 工具 / 终端）都会自动刷新页面，并弹出「刷新成功」气泡（约 4-5 秒）。
- 🏠 **无需 sudo**：全部安装到 `~/.dsh` 下，不需要 root 权限或系统服务。
- 🔒 **仅限本机**：托管的 UI 只监听本机 `127.0.0.1`。

## 安装

环境要求：Node.js、npm 或 npx，最好再装上 pnpm。

```bash
git clone https://github.com/Eddie0521/better-dsh.git
cd better-dsh
bash install.sh
source ~/.zshrc
rehash 2>/dev/null || true
```

安装脚本会更新你的用户级 profile，并安装到：

```text
~/.dsh/profiles/web    # 托管的 Web profile
~/.dsh/bin/dsh         # dsh 命令（supervisor + 官方 CLI 分发器）
```

无需输入密码。安装完成后请打开一个新的终端窗口。

## 使用方式

```bash
dsh start
dsh status
dsh restart
dsh stop
```

- 托管的 Web UI 地址为 `http://127.0.0.1:3080`。
- profile 默认为 `web`，可通过 `dsh --profile <name>` 或 `DSH_PROFILE` 环境变量切换。
- 设置 `DSH_REAL_BIN` 可指定稳定的 DSH 可执行文件，跳过 `npx` 查找。
- 日志和 PID 文件位于 `~/.dsh/profiles/web/`。

### `dsh` 分发器

`dsh` 是一个薄分发器：`start` / `stop` / `restart` / `status` 走 supervisor，
**其余参数原样透传给官方 DeepSeek Harness CLI**，所以 `dsh web`、`dsh plugin …`、
`dsh --profile <name>` 都照常可用。

supervisor 按 profile 端口（默认 `3080`）跟踪进程，而不仅是自己的 PID 文件：
`dsh status` 能识别手动启动的服务（显示 `running (not supervised)`），
`dsh start` 会直接接管它，`dsh stop` 也能停掉它。

## 插件

插件放在 `plugins/<name>/` 下——每个都是标准的 DSH 插件包（host 端 + `lib/client.js`
浏览器 bundle）。`install.sh` 会自动构建缺失的 bundle、以 `link:` 依赖写入 profile、
并追加 cordis patch `insert` 行，下次重启即挂载。

```text
plugins/
  dsh-restart-button/   # 侧边栏「设置」行右端的一键重启按钮
```

目录里带 `.disabled` 标记的插件会被 `install.sh` 跳过（本地停用开关，标记已 gitignore）。
每个插件也自带 `cordis.patch.yml`（npm 渠道用），所以 `dsh plugin --profile web add <name>`
同样可装。

## 开发

```bash
bash lib/dsh-supervisor.sh status   # 直接运行守护进程
```

- `bin/dsh` 是入口，守护逻辑都在 `lib/dsh-supervisor.sh` 中。
- `dsh restart` 是脱离式的：立即返回，setsid 子进程完成重启并把结果写入
  `~/.dsh/profiles/<name>/dsh-restart-detached.result`（`dsh restart-sync` 保留旧的阻塞形式）。
- supervisor 启动前会删除 `cordis.yml` 让启动进程全新重建，避开 macOS provenance（EPERM）
  对"不同来源进程写同一文件"的拦截。

## 许可证

[MIT](LICENSE)。DeepSeek Harness 及其资源仍受各自的上游许可证和商标政策约束。
