# dsh-market

<h4 align="right"><strong>简体中文</strong> | <a href="README_EN.md">English</a></h4>

<p align="center">
  <img src="https://github.com/Eddie0521/better-dsh/raw/main/assets/deepseek.svg" alt="DeepSeek" width="138" />
</p>

<h1 align="center">dsh-market</h1>

<p align="center"><strong>DeepSeek Harness Web 内置插件市场</strong></p>

<p align="center">
  在 <strong>设置 → 插件</strong> 里新增一个「插件市场」页签：通过公开的 npm / GitHub API 搜索 DeepSeek Harness 插件，按下载量或 Star 排序，双栏展示，滚动懒加载。
</p>

## 特性

- 🏪 **设置页内嵌**：注册为 `settings.plugins.tab` 插槽，与「插件列表」页签并排。
- 🔍 **搜索框**：输入关键词即搜索（300ms 防抖），留空浏览全部。
- 📊 **按下载量排序**：npm registry 搜索（`dsh-plugin` 关键词语料），每页附加真实的近 30 天下载量（npm 批量接口）并按下载量重排。
- ⭐ **按 Star 排序**：GitHub `topic:dsh-plugin` 搜索，服务端按 Star 全局排序，并过滤掉没有对应 npm 包的仓库。
- 🪜 **双栏 + 懒加载**：两列卡片网格，IntersectionObserver 滚动到底自动加载下一页（另有「加载更多」按钮兜底）。
- 🔒 **只读、纯浏览器**：全部请求都是公开 API（CORS 开放），不经过 Host，无设置通道、无写权限。

## 安装

### 方式一：better-dsh（本地开发）

插件位于 better-dsh 仓库的 `plugins/dsh-market/`。运行 better-dsh 的 `install.sh` 会自动构建、link 到 profile 并挂载：

```bash
git clone https://github.com/Eddie0521/better-dsh.git
cd better-dsh
bash install.sh
dsh restart   # 重启后刷新浏览器页面
```

### 方式二：npm（正式安装）

```bash
dsh plugin --profile web add dsh-market
```

包自带 `dsh.bundle.patch`，官方 CLI 会自动把它加进 profile 的 bundle 栈并挂载。

## 使用

1. 打开 Web UI → 设置 → 插件，点「插件市场」页签。
2. 默认按下载量排序；点「按 Star」切换语料。
3. 在搜索框输入关键词过滤（如 `sidebar`、`feishu`）。
4. 滚动列表，触底自动加载下一页；卡片上可跳转 npm / GitHub。

## 数据源与限制

- **npm registry 搜索**：`registry.npmjs.org/-/v1/search`，空查询使用 `keywords:dsh-plugin`（生态自声明关键词，约 900+ 包）。
- **下载量**：`api.npmjs.org/downloads/point/last-month`（近 30 天，批量）。
- **Star**：`api.github.com/search/repositories` 的 `repo:` 限定符批量查询；结果缓存在 localStorage（24 小时 TTL），以绕过 GitHub 未认证搜索限流（10 次/分钟）。被限流时 Star 显示为缺省，不影响列表。
- **Star 模式的过滤**：只保留「有同名 npm 包」且名称符合 `dsh-*` / `deepseek-harness` / `deepseek-ai` 组织的仓库，排除 harness 主仓库，避免 GitHub topic 里的无关项目混入。
- 官方 `@deepseek-ai/dsh-*` 包不带 `dsh-plugin` 关键词，不在此语料中（它们已随 profile 预装）。

## 开发

```bash
pnpm install
pnpm build      # 产出 lib/index.js（空 host 存根）+ lib/client.js（浏览器 bundle）
pnpm watch      # 增量构建
pnpm typecheck
```

- 客户端 bundle 通过 `window.__ModuleLoader__.load({ id: "dsh-market", ... })` 注册，`dsh.client.platform: web` 让 client-modules 自动发现并服务 `/plugins/dsh-market/client.js`。
- tab 注册：`ctx.slots.inject('settings.plugins.tab', …)`，`order: 20` 排在「插件列表」（order 10）之后。

## License

[MIT](LICENSE)。DeepSeek Harness 及其资源仍受各自的上游许可证和商标政策约束。
