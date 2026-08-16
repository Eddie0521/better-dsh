<h4 align="right"><a href="README.md">English</a> | <strong>简体中文</strong></h4>

<p align="center">
  <img src="assets/better-dsh.svg" alt="better-dsh" width="138" />
</p>

<h1 align="center">better-dsh</h1>

<p align="center"><strong>把 DeepSeek Harness Web 作为托管的后台服务运行</strong></p>

<p align="center">
  一个为 <a href="https://github.com/deepseek-ai/deepseek-harness">DeepSeek Harness</a> Web Profile 提供的用户级守护进程。
</p>

## 特性

- 🚀 **一条命令启动**：`dsh start` 在后台启动 Web UI（`http://127.0.0.1:3080`），并提供 `status`、`restart`、`stop`。
- ⚡ **一条命令安装**：`install.sh` 创建你的用户级 Web profile、安装官方 HTTP Fetch Provider，并把 `dsh` 加入 PATH。
- 🔄 **安全重启**：守护进程独立于 DSH 进程之外，可以安全地停止和重启 DSH。
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
~/.dsh/bin/dsh         # dsh 命令
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

## 开发

```bash
bash lib/dsh-supervisor.sh status   # 直接运行守护进程
```

- `bin/dsh` 是入口，所有逻辑都在 `lib/dsh-supervisor.sh` 中。
- 安装脚本会向 profile 的 `cordis.patch.yml` 注入 HTTP Fetch Provider——安装第三方包前请先审查。
- HTTP Fetch Provider 会扩大 Host 网络访问权限；除非你清楚安全影响，否则请保持 UI 仅监听 localhost。

## 许可证

[MIT](LICENSE)。DeepSeek Harness 及其资源仍受各自的上游许可证和商标政策约束。
