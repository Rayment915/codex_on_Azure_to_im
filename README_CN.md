# codex_on_Azure_to_im

将 Codex on Azure、Claude Code 或兼容 Codex 的运行时桥接到 IM 平台，让你可以直接在 Telegram、Discord、飞书 / Lark、QQ 中和编程代理对话。

[English](README.md)

> 这个仓库参考并改造自 [Claude-to-IM](https://github.com/op7418/Claude-to-IM-skill)。本分支重点增强了 Codex on Azure 的稳定性，补齐了 macOS `launchd` 环境变量转发，并兼容 Codex on Azure Foundry 风格的配置方式。

---

## 工作原理

本项目会运行一个后台守护进程，把 IM 机器人和 Claude Code / Codex 会话连接起来。来自 IM 的消息会转发给 AI 编程代理，代理的响应会再发回聊天中，包括：

- 普通文本回复
- 工具调用
- 权限审批请求
- 流式输出预览

```text
你 (Telegram/Discord/飞书/QQ)
  ↕ Bot API
后台守护进程 (Node.js)
  ↕ Claude Agent SDK 或 Codex SDK / Codex CLI fallback
Claude Code / Codex on Azure → 读写你的代码库
```

## 功能特点

- **支持四个 IM 平台**：Telegram、Discord、飞书 / Lark、QQ，可按需组合启用
- **交互式配置**：逐步收集 token 和平台配置
- **权限控制**：工具调用需要显式批准
- **流式预览**：可实时查看模型输出
- **会话持久化**：守护进程重启后对话仍可保留
- **密钥保护**：配置文件权限为 `600`，日志自动脱敏
- **对 Codex on Azure 友好**：支持 `~/.codex/config.toml` 的 Azure 配置，包括 Azure OpenAI / Azure Foundry 风格 provider
- **兼容 macOS launchd**：后台守护进程会转发 Azure 相关环境变量，例如 `AZURE_OPENAI_API_KEY`
- **SDK 优先，CLI 回退**：优先使用 Codex SDK；如果 SDK 和 CLI 组合存在兼容问题，会自动回退到直接执行 Codex CLI

## 前置要求

- **Node.js >= 20**
- **Claude Code CLI**
  适用于 `CTI_RUNTIME=claude` 或 `auto`
- **Codex CLI**
  适用于 `CTI_RUNTIME=codex` 或 `auto`

安装 Codex CLI：

```bash
npm install -g @openai/codex
```

如果你使用 Codex on Azure，需要：

- 配置 `~/.codex/config.toml`
- 确保运行环境中存在 `AZURE_OPENAI_API_KEY`

## Codex on Azure / Foundry 配置示例

这个仓库兼容通过 `~/.codex/config.toml` 指向 Azure OpenAI 或 Azure AI Foundry 风格端点的配置，例如：

```toml
model = "gpt-5.4"
model_provider = "azure"

[model_providers.azure]
name = "Azure OpenAI"
base_url = "https://YOUR-RESOURCE.openai.azure.com/openai/v1"
env_key = "AZURE_OPENAI_API_KEY"
wire_api = "responses"
```

同时确保环境变量存在：

```bash
export AZURE_OPENAI_API_KEY=your-key
```

在 macOS 上，本分支会把 Azure 相关环境变量转发到 `launchd` 守护进程里，这样通过飞书、Telegram、Discord、QQ 触发的后台任务也能正常使用 Codex on Azure。

## 安装

### Claude Code

```bash
git clone https://github.com/Rayment915/codex_on_Azure_to_im.git ~/.claude/skills/claude-to-im
```

### Codex

```bash
git clone https://github.com/Rayment915/codex_on_Azure_to_im.git ~/.codex/skills/claude-to-im
```

或者使用安装脚本：

```bash
git clone https://github.com/Rayment915/codex_on_Azure_to_im.git ~/code/codex_on_Azure_to_im
bash ~/code/codex_on_Azure_to_im/scripts/install-codex.sh
```

## 验证安装

**Claude Code：**

- 启动新会话
- 输入 `/`
- 你应该能看到 `claude-to-im`

**Codex：**

- 启动新会话
- 输入 `claude-to-im setup` 或 `start bridge`

## 快速开始

### 1. 配置

```text
/claude-to-im setup
```

向导会引导你完成：

1. 选择渠道：Telegram、Discord、飞书、QQ
2. 输入凭据：向导会说明 token 去哪里拿
3. 设置默认值：工作目录、模型、模式
4. 验证：立即调用平台 API 检查配置有效性

### 2. 启动

```text
/claude-to-im start
```

守护进程会在后台启动。

- macOS 下通过 `launchd` 运行
- 关闭终端后仍会继续运行

### 3. 聊天

打开你的 IM 应用，给机器人发消息。

当代理需要使用工具时：

- Telegram / Discord：会看到 **Allow / Deny** 按钮
- 飞书 / QQ：会看到文本形式的 `/perm` 审批提示

### 飞书快速配置示例

如果你想最快跑通一个可用的飞书版本，可以按这个最小流程来：

1. 创建飞书自建应用，拿到：
   - `CTI_FEISHU_APP_ID`
   - `CTI_FEISHU_APP_SECRET`
2. 在 `~/.claude-to-im/config.env` 中写入类似配置：

```env
CTI_RUNTIME=codex
CTI_ENABLED_CHANNELS=feishu
CTI_DEFAULT_WORKDIR=/path/to/your/project
CTI_FEISHU_APP_ID=cli_xxx
CTI_FEISHU_APP_SECRET=xxx
CTI_FEISHU_DOMAIN=https://open.feishu.cn
```

3. 在飞书开放平台中：
   - 批量添加所需的 bot / message / card 权限
   - 启用 **Bot** 能力
   - 发布并审批第一版
4. 启动 bridge：

```bash
bash scripts/daemon.sh start
```

5. 回到飞书开放平台，配置：
   - 订阅方式：**长连接**
   - 事件：`im.message.receive_v1`
   - 回调：`card.action.trigger`
6. 再发布并审批一次
7. 在飞书里给机器人发送 `hello`，确认它能回复

如果你使用的是 Codex on Azure，记得在启动 bridge 之前确保 `AZURE_OPENAI_API_KEY` 对守护进程环境可见。

## 命令列表

所有命令都在 Claude Code 或 Codex 里执行：

| Claude Code | Codex（自然语言） | 说明 |
|---|---|---|
| `/claude-to-im setup` | `claude-to-im setup` / `配置` | 交互式配置 |
| `/claude-to-im start` | `start bridge` / `启动桥接` | 启动守护进程 |
| `/claude-to-im stop` | `stop bridge` / `停止桥接` | 停止守护进程 |
| `/claude-to-im status` | `bridge status` / `状态` | 查看运行状态 |
| `/claude-to-im logs` | `查看日志` | 查看最近 50 行日志 |
| `/claude-to-im logs 200` | `logs 200` | 查看最近 200 行日志 |
| `/claude-to-im reconfigure` | `reconfigure` / `修改配置` | 修改配置 |
| `/claude-to-im doctor` | `doctor` / `诊断` | 运行诊断 |

## 平台配置指南

`setup` 向导会给出逐步指引，这里是摘要版。

### Telegram

1. 打开 Telegram，搜索 `@BotFather`
2. 发送 `/newbot`
3. 按提示创建机器人
4. 复制 Bot Token
5. 可选：执行 `/setprivacy` -> Disable
6. 使用 `@userinfobot` 查询自己的 User ID

### Discord

1. 打开 Discord Developer Portal
2. 创建新应用
3. 在 Bot 页面重置并复制 Token
4. 开启 **Message Content Intent**
5. 在 OAuth2 / URL Generator 里生成邀请链接

### 飞书 / Lark

1. 打开飞书开放平台或 Lark Open Platform
2. 创建自建应用
3. 获取 App ID 和 App Secret
4. 在“权限与范围”中批量添加所需权限
5. 启用 Bot 能力
6. 在“事件与回调”里启用 **长连接**
7. 添加 `im.message.receive_v1`
8. 发布并审批应用

### QQ

> QQ 目前只支持 **C2C 私聊**，不支持群聊 / 频道，也不支持内联按钮审批。

1. 打开 QQ Bot OpenClaw
2. 创建或选择机器人
3. 获取 App ID 和 App Secret
4. 配置沙箱接入
5. 扫码添加机器人

## 架构

```text
~/.claude-to-im/
├── config.env             ← 凭据与设置 (chmod 600)
├── data/                  ← 持久化 JSON 存储
│   ├── sessions.json
│   ├── bindings.json
│   ├── permissions.json
│   └── messages/
├── logs/
│   └── bridge.log
└── runtime/
    ├── bridge.pid
    └── status.json
```

### 核心组件

| 组件 | 作用 |
|---|---|
| `src/main.ts` | 守护进程入口 |
| `src/config.ts` | 加载 / 保存 `config.env` |
| `src/store.ts` | JSON 存储层 |
| `src/llm-provider.ts` | Claude Agent SDK → SSE |
| `src/codex-provider.ts` | Codex SDK → SSE，并在需要时回退到直接 Codex CLI |
| `src/sse-utils.ts` | SSE 格式化工具 |
| `src/permission-gateway.ts` | 权限审批桥接 |
| `src/logger.ts` | 日志与脱敏 |
| `scripts/daemon.sh` | 进程管理 |
| `scripts/doctor.sh` | 诊断脚本 |

### 权限流程

```text
1. 代理想使用工具（例如编辑文件）
2. SDK 触发权限请求
3. Bridge 把请求转成聊天里的审批交互
4. 用户批准或拒绝
5. Bridge 把结果回传给运行时
6. 工具继续执行，结果再回到聊天中
```

## 故障排查

运行：

```text
/claude-to-im doctor
```

它会检查：

- Node.js 版本
- 配置文件是否存在
- 配置文件权限
- token 是否有效
- 日志目录是否可写
- PID 文件是否一致
- 最近是否有错误

| 问题 | 解决方案 |
|---|---|
| `Bridge 无法启动` | 运行 `doctor`，检查 Node 和日志 |
| `收不到消息` | 检查 token、允许用户配置、事件订阅 |
| `权限超时` | 用户未在 5 分钟内审批，调用自动拒绝 |
| `PID 文件残留` | 运行 `stop` 再 `start` |

更多说明见 [references/troubleshooting.md](references/troubleshooting.md)。

## 安全

- 所有凭据保存在 `~/.claude-to-im/config.env`
- 文件权限为 `chmod 600`
- 日志自动脱敏
- 可通过允许用户 / 频道 / 服务器列表限制访问范围
- 守护进程不提供入站网络监听

详见 [SECURITY.md](SECURITY.md)。

## 开发

```bash
npm install        # 安装依赖
npm run dev        # 开发模式运行
npm run typecheck  # 类型检查
npm test           # 运行测试
npm run build      # 构建打包
```

## 发布说明

- `config.env` 已被忽略，不应提交到仓库
- 用户安装时应从 `config.env.example` 开始
- 在 macOS 上，`scripts/supervisor-macos.sh` 会把运行时环境变量转发给 `launchd`
- 这对 Codex on Azure / Azure Foundry 风格配置尤其重要

## 许可

[MIT](LICENSE)
