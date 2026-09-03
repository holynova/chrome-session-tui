# Chrome Session TUI
macOS Chrome 进程清理 TUI。
![截图](docs/screenshot.svg)
Repo: https://github.com/holynova/chrome-session-tui
Pages: https://holynova.github.io/chrome-session-tui/

## 构建与测试

```bash
pnpm run build
pnpm test
pnpm run typecheck
```

`pnpm run build` 同时生成 CLI 到 `dist/`，并将 Pages 展示页与截图复制到 `dist/` 根目录；Cloudflare Workers Static Assets 发布 `dist/`。
