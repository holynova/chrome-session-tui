<p align="center">
  <img src="./assets/readme/hero.svg" width="100%" alt="Chrome Session TUI — macOS Chrome 自动化会话管理终端工具：终端窗口里一行黄色自动化会话可关闭，一行绿色正常 Chrome 受保护">
</p>

<p align="center">
  <a href="https://xiaosang.cc/chrome-session-tui/">▶ 在线介绍 Online Intro</a>
  ·
  <a href="https://github.com/holynova/chrome-session-tui">GitHub 仓库</a>
</p>

Chrome Session TUI 是一款 macOS 终端工具，用来查看和清理 Chrome 自动化会话：把 Chrome 主会话与 Renderer / GPU / Utility 子进程聚合展示，识别 Playwright、Puppeteer、Headless 与远程调试实例，正常 Chrome 默认受保护、不会被误关。交互式 TUI 每 2 秒自动刷新，也提供 `list` / `inspect` / `merge` / `close` 命令行子命令。

Chrome Session TUI is a macOS terminal tool for inspecting and closing Chrome automation sessions. It aggregates each Chrome main session with its renderer/GPU/utility child processes, identifies Playwright, Puppeteer, headless and remote-debugging instances, and protects normal Chrome from accidental closure. The interactive TUI auto-refreshes every 2 seconds; `list` / `inspect` / `merge` / `close` subcommands are also available.

## 截图 / Screenshot

<p align="center">
  <img src="./assets/readme/screenshot.svg" width="800" alt="TUI 界面：2 个主会话，黄色 AI/自动化会话（PID 20327，2 窗口 11 个 Tab）可关闭，绿色正常 Chrome（PID 89721）受保护">
</p>

## 功能 / Features

- **会话聚合**：只显示 Chrome 主会话，子进程合并到所属会话，附运行时间、内存、CPU 与进程数。
- **来源识别**：按启动命令与祖先进程识别 Playwright、Puppeteer、ChromeDriver、Selenium、chrome-devtools-mcp、Headless 与远程调试会话。
- **窗口与 Tab 数**：自动化会话走 CDP 读窗口/Tab 数，正常 Chrome 走 AppleScript。
- **安全清理**：关闭默认发 SIGTERM，加 `--force` 才在短暂等待后发 SIGKILL；被多个会话共享的控制器进程不会被杀掉。
- **窗口合并**：把一个会话的多个窗口合并到第一个窗口（`m` 键或 `merge <pid>`）。
- **正常 Chrome 受保护**：`close` 命令与 TUI 的关闭操作都不会触碰正常浏览器。

## 快捷键 / Keys

| 按键 | 作用 |
|---|---|
| ↑ / ↓、j / k | 选择会话 |
| Enter / d | 展开/收起详情 |
| m | 合并当前会话窗口 |
| x / X | 关闭当前会话（X 为强制） |
| a / A | 关闭全部自动化会话（A 为强制） |
| r | 立即刷新 |
| q / Esc | 退出 |

关闭前都会弹确认，按 `y` 确认、`n` 取消。

## 使用 / Usage

需要 macOS 与 Node.js ≥ 22：

```bash
git clone https://github.com/holynova/chrome-session-tui.git
cd chrome-session-tui
pnpm install
pnpm start          # 打开交互式 TUI
```

命令行子命令：

```bash
chrome-session list [--json]   # 列出当前 Chrome 主会话
chrome-session inspect <pid>   # 查看一个会话的详细信息
chrome-session merge <pid>     # 把会话窗口合并到第一个窗口
chrome-session close --all     # 关闭全部自动化 / Headless 会话
chrome-session close <pid>     # 关闭指定会话（--force 强制）
```

## 技术 / Tech

- Ink 7 + React 19 + TypeScript，tsup 打包，vitest 测试（4 个用例）。
- 会话快照来自 `ps` 进程扫描 + 启动命令行分析；窗口信息来自 CDP（自动化会话）与 AppleScript（正常 Chrome）。

```
src/cli.ts          命令行入口：tui / list / inspect / merge / close
src/ui.tsx          Ink 交互界面：列表、详情、确认框、快捷键
src/processes.ts    会话快照、来源识别、CDP/AppleScript 窗口读取、关闭与合并
src/format.ts       表格与时长格式化
src/types.ts        ChromeSession 等类型定义
docs/index.html     静态介绍页
docs/screenshot.svg TUI 界面示意图
```

## English

**Chrome Session TUI** is a macOS terminal tool for inspecting and closing Chrome automation sessions. It aggregates Chrome main sessions with their child processes, identifies Playwright, Puppeteer, headless and remote-debugging instances, and keeps normal Chrome protected.

- **Session aggregation**: only main sessions are listed; renderer/GPU/utility children roll up into their session, with uptime, memory, CPU and process counts.
- **Source detection**: classifies sessions from launch flags and ancestor processes (Playwright, Puppeteer, ChromeDriver, Selenium, chrome-devtools-mcp, headless, remote debugging).
- **Window & tab counts**: read via CDP for automation sessions and via AppleScript for normal Chrome.
- **Safe closing**: SIGTERM by default; `--force` escalates to SIGKILL after a short wait. A controller process shared by multiple sessions is never killed.
- **Window merge**: merge a session's windows into the first window (`m` or `merge <pid>`).
- **Run it**: macOS + Node.js ≥ 22. `pnpm install && pnpm start` opens the TUI; `list`, `inspect`, `merge` and `close` work headlessly.
- **Tech**: Ink 7 + React 19 + TypeScript, tsup build, vitest (4 tests).
