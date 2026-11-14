# Chrome Session TUI

macOS 上用的 Chrome 会话清理终端工具：把 Chrome 主会话和子进程聚合展示，认出 Playwright、Puppeteer、Headless、远程调试等自动化会话，一键关掉跑完测试后遗留的进程。正常打开的 Chrome 默认受保护，不会被关掉。

![截图](docs/screenshot.svg)

当前版本：`v0.1.1`。仓库：[holynova/chrome-session-tui](https://github.com/holynova/chrome-session-tui) · 在线介绍：[holynova.github.io/chrome-session-tui](https://holynova.github.io/chrome-session-tui/)

## 系统要求

- macOS（依赖 macOS 的 `ps` 与 AppleScript，Linux/Windows 不能用）
- Node.js 22 或更高版本
- 已安装 Chrome 或 Chromium

## 安装与启动

```bash
git clone https://github.com/holynova/chrome-session-tui.git
cd chrome-session-tui
pnpm install
pnpm build
pnpm start
```

开发时可用 `pnpm dev` 直接跑源码，改完即生效。

想在任意目录用 `chrome-session` 命令：

```bash
pnpm build
pnpm link --global
```

## 终端界面按键

| 按键 | 作用 |
| --- | --- |
| ↑ / ↓ 或 j / k | 选择会话 |
| Enter / d | 展开或收起详情 |
| m | 把该会话的窗口合并到第一个窗口（仅支持的会话） |
| x | 关闭选中的自动化会话（会先确认） |
| X | 强制关闭选中的自动化会话（先 SIGTERM，250 毫秒后仍在就 SIGKILL，会先确认） |
| a | 关闭全部自动化会话（会先确认） |
| A | 强制关闭全部自动化会话（会先确认） |
| r | 立即刷新（平时每 2 秒自动刷新） |
| q / Esc | 退出 |

列表颜色：绿色是正常 Chrome（受保护），黄色是自动化会话，紫色是 Headless 会话。

## 命令行用法

```bash
chrome-session                 # 打开交互式界面
chrome-session list            # 列出当前 Chrome 主会话
chrome-session list --json     # 以 JSON 输出
chrome-session inspect <pid>   # 查看一个会话的详细信息
chrome-session merge <pid>     # 把该会话的窗口合并到第一个窗口
chrome-session close <pid>     # 关闭指定的自动化会话
chrome-session close --all     # 关闭全部自动化会话（会先确认）
chrome-session close --all --yes  # 跳过确认，直接关闭全部
```

`close` 默认发送 SIGTERM；加 `--force` 才会在短暂等待后发送 SIGKILL。正常 Chrome 受保护，不会被这些命令关闭。

## 常见问题

### 窗口和 Tab 数量读不到？

普通 Chrome 靠 AppleScript 读取：首次使用时 macOS 会弹权限请求，在「系统设置 → 隐私与安全性 → 自动化」里允许终端控制 Chrome 即可。带 `--remote-debugging-port` 的会话走 CDP 直读；Headless 会话没有图形窗口，读不到是正常的。

### 为什么有些会话显示「不可合并」？

只有 AppleScript 能读到的会话才能合并窗口。CDP 会话目前只读，不支持合并。

### 关闭时控制器进程会一起关吗？

单个会话的控制器（如 Playwright 进程）会一起关闭；如果控制器被多个会话共享，则不会关掉它，避免影响其他会话。

## 开发与测试

```bash
pnpm test       # 单元测试
pnpm typecheck  # 类型检查
pnpm build      # 构建 dist/cli.js
```
