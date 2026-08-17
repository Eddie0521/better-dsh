# dsh-restart-button

<h4 align="right"><strong>简体中文</strong> | <a href="README_EN.md">English</a></h4>

<p align="center">
  <img src="https://github.com/Eddie0521/better-dsh/raw/main/assets/deepseek.svg" alt="DeepSeek" width="138" />
</p>

<h1 align="center">dsh-restart-button</h1>

<p align="center"><strong>点一下，重启 + 刷新</strong></p>

<p align="center">
  在 DeepSeek Harness Web 侧边栏底部「设置」行的最右端放一个刷新按钮：点击后执行脱离式 <code>dsh restart</code>，等服务恢复后页面自动刷新。
</p>

## 特性

- 🔘 **位置**：侧边栏底部「设置」按钮同行、最右端（窄栏/折叠态自动隐藏）。
- 🔄 **一键重启**：点击 → `POST /dsh-restart`（host 端路由，立即返回）→ supervisor 的 setsid 子进程完成 stop/start（4-5 秒）。
- 🤖 **AI-native**：注册 `dsh_restart` 工具，agent 可直接调用同样的重启流程。
- 🪟 **全部来源自动刷新**：按钮 / agent 工具 / 终端触发的任何重启，服务恢复后页面自动 reload，并从按钮位置弹出「刷新成功」气泡（1.6 秒上浮动效）。
- 🔒 **只读安全**：路由仅 POST、同源可达（服务默认只绑 127.0.0.1），不暴露任何写接口。

## 安装

```bash
cd better-dsh
bash install.sh    # 自动构建、link 进 profile、追加 cordis patch insert
dsh restart        # 挂载后刷新浏览器页面
```

或通过官方 CLI：`dsh plugin --profile web add dsh-restart-button`（包自带 `dsh.bundle.patch`）。

## 工作原理

```
点击按钮
  → client: POST /dsh-restart
  → host 路由: spawn bash $DSH_HOME/bin/dsh-supervisor.sh restart（detached）
  → supervisor: 立即返回；setsid 子进程 sleep 1s → stop → start（先 rm cordis.yml）
  → client: 轮询 /，观察到"掉线→恢复"后 window.location.reload()
```

## 开发

```bash
pnpm install
pnpm build        # lib/index.js（host 路由）+ lib/client.js（浏览器按钮）
pnpm watch
pnpm typecheck
```

## License

[MIT](LICENSE)。DeepSeek Harness 及其资源仍受各自的上游许可证和商标政策约束。
