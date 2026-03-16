# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

ClawX 是一个跨平台的 **Electron 桌面应用**，为 OpenClaw AI 智能体运行时提供图形化界面。使用 React 19、Vite、TypeScript 和 Electron 40+ 构建，包管理器为 **pnpm**（版本在 `package.json` 的 `packageManager` 字段中固定）。

应用直接嵌入 OpenClaw 运行时并作为子进程管理，为用户提供"开箱即用"体验——无需单独安装 OpenClaw。

## 开发命令

```bash
# 初始化设置
pnpm run init                 # 安装依赖 + 下载捆绑的 uv 运行时

# 开发
pnpm dev                      # 启动开发服务器（Vite + Electron 热重载）

# 代码质量
pnpm lint                     # 运行 ESLint 自动修复
pnpm typecheck                # TypeScript 类型检查

# 测试
pnpm test                     # 运行 Vitest 单元测试

# 构建
pnpm run build:vite           # 仅构建前端（用于测试 UI 构建）
pnpm build                    # 完整生产构建 + 打包当前平台
pnpm package:mac              # 构建并打包 macOS 版本
pnpm package:win              # 构建并打包 Windows 版本
pnpm package:linux            # 构建并打包 Linux 版本
```

## 架构设计

### 双进程架构

ClawX 遵循**双进程架构**，职责清晰分离：

```
┌─────────────────────────────────────────────────────────────────┐
│                    Electron 主进程                               │
│  • 窗口和生命周期管理                                              │
│  • Gateway 进程监督（OpenClaw 运行时）                             │
│  • 系统集成（托盘、通知、钥匙串）                                    │
│  • 传输策略（WS → HTTP → IPC 降级）                                │
│  • API 路由和代理（避免渲染进程 CORS）                              │
└──────────────────────┬──────────────────────────────────────────┘
                       │ IPC 桥接
┌──────────────────────▼──────────────────────────────────────────┐
│                   React 渲染进程                                 │
│  • UI 组件（React 19 + shadcn/ui）                               │
│  • 状态管理（Zustand）                                            │
│  • 通过 host-api/api-client 统一 API 调用                         │
│  • Markdown 渲染、i18n、动画                                      │
└──────────────────────┬──────────────────────────────────────────┘
                       │ 主进程控制的传输（WS/HTTP/IPC）
┌──────────────────────▼──────────────────────────────────────────┐
│                   OpenClaw Gateway（子进程）                      │
│  • AI 智能体运行时和编排                                           │
│  • 频道管理（Telegram、Discord 等）                                │
│  • 技能/插件执行                                                   │
│  • 提供商抽象层（OpenAI、Anthropic 等）                            │
└─────────────────────────────────────────────────────────────────┘
```

### 关键目录结构

```
electron/
├── api/                     # 主进程 API 路由和处理器
│   └── routes/              # 路由模块（agents、channels、cron 等）
├── services/                # 核心服务
│   ├── providers/           # 提供商/账户模型同步
│   └── secrets/             # 操作系统钥匙串集成
├── gateway/                 # OpenClaw Gateway 进程管理器
├── main/                    # 应用入口、窗口、IPC 注册
├── preload/                 # 安全 IPC 桥接
└── utils/                   # 存储、认证、路径

src/                         # React 渲染进程
├── lib/                     # 统一前端 API + 错误模型
│   ├── api-client.ts        # 后端调用的唯一入口
│   └── host-api.ts          # IPC 包装抽象
├── stores/                  # Zustand 状态存储（settings、chat、gateway）
├── pages/                   # 主要页面（Setup、Chat、Channels 等）
├── components/              # 可复用 UI 组件
├── i18n/                    # 国际化资源
└── types/                   # TypeScript 类型定义
```

## 关键架构规则

### 渲染进程 ↔ 主进程 API 边界

**重要**：渲染进程绝对不能直接调用 Gateway HTTP 端点或在组件中添加新的原始 IPC 调用。

- **使用统一 API 客户端**：所有从渲染进程到后端的调用必须通过 `src/lib/host-api.ts` 和 `src/lib/api-client.ts`
- **禁止直接 Gateway HTTP**：永远不要从渲染进程 `fetch('http://127.0.0.1:18789/...')`（会导致 CORS 问题）
- **禁止组件中的原始 IPC**：不要直接添加 `window.electron.ipcRenderer.invoke(...)`；通过 host-api/api-client 暴露
- **传输策略由主进程控制**：协议选择（WS → HTTP → IPC 降级）由 Electron 主进程控制，不是渲染进程

### 配置同步

应用会自动将某些设置同步到 OpenClaw 配置：

- **代理设置**：应用于 Electron 网络和 OpenClaw Gateway（包括 Telegram 频道配置）
- **Kimi/Moonshot 联网搜索**：配置 Moonshot 提供商时，启用 Kimi 联网搜索并同步到中国端点
- **提供商凭证**：存储在操作系统钥匙串，启动时同步到 OpenClaw 配置

## 重要开发注意事项

### 包管理器

- **仅使用 pnpm**：精确版本在 `package.json` 的 `packageManager` 中固定
- 在 `pnpm install` 之前运行 `corepack enable && corepack prepare` 以激活正确的 pnpm 版本

### Gateway 生命周期

- 运行 `pnpm dev` 时，OpenClaw Gateway 自动在端口 **18789** 启动
- Gateway 在应用启动后需要约 10-30 秒才能就绪
- Gateway 就绪状态**不是** UI 开发的必要条件——应用在没有 Gateway 时也能正常运行（显示"连接中"状态）
- Gateway 进程由主进程监督，崩溃时自动重启

### 数据存储

- **无数据库**：使用 `electron-store`（JSON 文件）存储应用设置
- **密钥**：API 密钥存储在操作系统原生钥匙串（macOS Keychain、Windows 凭据管理器、Linux Secret Service）
- **OpenClaw 配置**：在操作系统特定的应用数据目录中管理
- **会话记录**：从 OpenClaw 配置目录中的 `.jsonl` 记录文件解析 token 使用情况

### AI 提供商配置

- 实际的 AI 对话需要通过"设置 → AI 提供商"配置至少一个提供商 API 密钥
- OpenAI 支持 API 密钥和浏览器 OAuth（Codex 订阅）登录
- 应用在没有配置提供商密钥的情况下仍可完全导航和测试

### 测试

- **单元测试**：使用 Vitest 和 jsdom 环境，位于 `tests/unit/`
- **设置文件**：`tests/setup.ts` 配置测试环境
- 测试运行时支持别名（`@/*` 指向 src，`@electron/*` 指向 electron）

### 常见开发陷阱

- **`pnpm run lint` 竞态条件**：如果刚运行过 `pnpm run uv:download`，ESLint 可能失败并显示 `ENOENT: scandir '/workspace/temp_uv_extract'`。下载完成后重新运行 lint。
- **构建脚本警告**：关于忽略 `@discordjs/opus` 和 `koffi` 构建脚本的警告可以安全忽略（可选的频道依赖）
- **无头 Linux dbus 错误**：`Failed to connect to the bus` 错误在设置了 `$DISPLAY` 的无头环境中是预期的且无害的

## 构建和打包

### 构建流程

1. `vite build` - 编译 React 前端和 Electron 主进程/预加载进程
2. `bundle-openclaw.mjs` - 将 OpenClaw 运行时打包到 `build/openclaw/`
3. `bundle-openclaw-plugins.mjs` - 打包 OpenClaw 插件（dingtalk、wecom 等）
4. `electron-builder` - 打包成平台特定的安装程序

### 平台特定资源

每个平台都会打包特定的二进制文件：
- **macOS**：`resources/bin/darwin-{arch}` → 捆绑的 uv 运行时
- **Windows**：`resources/bin/win32-{arch}` → 捆绑的 uv 运行时
- **Linux**：`resources/bin/linux-{arch}` → 捆绑的 uv 运行时

## 多语言支持

应用支持英语、中文和日语的国际化：
- 本地化文件：`src/i18n/locales/`
- 在组件中使用 `react-i18next` 进行翻译
- **文档同步规则**：更改功能行为时，在同一次提交中更新 README.md、README.zh-CN.md 和 README.ja-JP.md

## 状态管理

- **Zustand 状态存储**用于所有应用状态（位于 `src/stores/`）
- 主要存储：
  - `settingsStore` - 应用设置和偏好
  - `chatStore` - 聊天对话和消息
  - `gatewayStore` - Gateway 连接状态和频道

## 样式

- **Tailwind CSS** 带自定义配置（`tailwind.config.js`）
- **shadcn/ui** 组件在 `src/components/ui/`
- **Framer Motion** 用于动画
- **Lucide React** 用于图标
- 支持亮色/暗色/系统主题

## WebSocket 通信

Gateway RPC 使用 WebSocket 优先通信：
- 首选：WebSocket 在 ws://127.0.0.1:18789
- 降级：HTTP 在 http://127.0.0.1:18789
- 最后手段：通过主进程的 IPC
- 连接监控，带自动重连和退避机制

## 安全考虑

- API 密钥永远不存储在代码或明文中——始终使用操作系统钥匙串
- 预加载脚本提供有限暴露的安全 IPC 桥接
- ASAR 打包，原生模块解包（`**/*.node`）
- 应用前验证代理设置以防止注入
