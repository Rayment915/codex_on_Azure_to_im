# codex_on_Azure_to_im

Bridge Codex on Azure, Claude Code, or Codex-compatible runtimes to IM platforms so you can chat with your coding agent from Telegram, Discord, Feishu/Lark, or QQ.

[中文文档](README_CN.md)

> This repository is based on and adapted from [Claude-to-IM](https://github.com/op7418/Claude-to-IM-skill). This fork focuses on stable Codex-on-Azure usage in IM chats, including macOS `launchd` environment forwarding and compatibility with Codex on Azure Foundry style configuration.

---

## How It Works

This project runs a background daemon that connects your IM bots to Claude Code or Codex sessions. Messages from IM are forwarded to the AI coding agent, and responses (including tool use, permission requests, and streaming previews) are sent back to your chat.

```
You (Telegram/Discord/Feishu/QQ)
  ↕ Bot API
Background Daemon (Node.js)
  ↕ Claude Agent SDK or Codex SDK / Codex CLI fallback
Claude Code / Codex on Azure → reads/writes your codebase
```

## Features

- **Four IM platforms** — Telegram, Discord, Feishu/Lark, QQ — enable any combination
- **Interactive setup** — guided wizard collects tokens with step-by-step instructions
- **Permission control** — tool calls require explicit approval via inline buttons (Telegram/Discord) or text `/perm` commands (Feishu/QQ)
- **Streaming preview** — see Claude's response as it types (Telegram & Discord)
- **Session persistence** — conversations survive daemon restarts
- **Secret protection** — tokens stored with `chmod 600`, auto-redacted in all logs
- **Codex on Azure friendly** — works with `~/.codex/config.toml` Azure setups, including Azure OpenAI / Azure Foundry-style provider configuration
- **launchd-safe on macOS** — forwards Azure runtime env vars such as `AZURE_OPENAI_API_KEY` into the background daemon
- **SDK-first, CLI-fallback** — prefers the Codex SDK path, and automatically falls back to direct Codex CLI execution when SDK/CLI compatibility issues occur
- **Zero code required** — install the skill and run `/claude-to-im setup`

## Prerequisites

- **Node.js >= 20**
- **Claude Code CLI** (for `CTI_RUNTIME=claude` or `auto`) — installed and authenticated (`claude` command available)
- **Codex CLI** (for `CTI_RUNTIME=codex` or `auto`) — `npm install -g @openai/codex`
- For Azure-backed Codex, configure `~/.codex/config.toml` and make sure required env vars such as `AZURE_OPENAI_API_KEY` are available to the daemon environment

### Codex on Azure / Foundry example

This repo is compatible with Codex configurations that point to Azure OpenAI or Azure AI Foundry-style endpoints through `~/.codex/config.toml`, for example:

```toml
model = "gpt-5.4"
model_provider = "azure"

[model_providers.azure]
name = "Azure OpenAI"
base_url = "https://YOUR-RESOURCE.openai.azure.com/openai/v1"
env_key = "AZURE_OPENAI_API_KEY"
wire_api = "responses"
```

Then make sure the shell or launch environment contains:

```bash
export AZURE_OPENAI_API_KEY=your-key
```

On macOS, this fork forwards Azure-related env vars into the `launchd` daemon so Feishu/Telegram/Discord/QQ-triggered background runs can still use Codex on Azure.

## Installation

### Claude Code

```bash
git clone https://github.com/Rayment915/codex_on_Azure_to_im.git ~/.claude/skills/claude-to-im
```

### Codex

```bash
git clone https://github.com/Rayment915/codex_on_Azure_to_im.git ~/.codex/skills/claude-to-im
```

Or use the provided install script:

```bash
git clone https://github.com/Rayment915/codex_on_Azure_to_im.git ~/code/codex_on_Azure_to_im
bash ~/code/codex_on_Azure_to_im/scripts/install-codex.sh
```

### Verify installation

**Claude Code:** Start a new session and type `/` — you should see `claude-to-im` in the skill list. Or ask Claude: "What skills are available?"

**Codex:** Start a new session and say `claude-to-im setup` or `start bridge`.

## Quick Start

### 1. Setup

```
/claude-to-im setup
```

The wizard will guide you through:

1. **Choose channels** — pick Telegram, Discord, Feishu, QQ, or any combination
2. **Enter credentials** — the wizard explains exactly where to get each token, which settings to enable, and what permissions to grant
3. **Set defaults** — working directory, model, and mode
4. **Validate** — tokens are verified against platform APIs immediately

### 2. Start

```
/claude-to-im start
```

The daemon starts in the background. On macOS it runs via `launchd`.

### 3. Chat

Open your IM app and send a message to your bot. Your configured runtime will respond.

When Claude needs to use a tool (edit a file, run a command), you'll see a permission prompt with **Allow** / **Deny** buttons right in the chat (Telegram/Discord), or a text `/perm` command prompt (Feishu/QQ).

### Feishu quick example

If you want the fastest path to a working Feishu setup, use this minimal flow:

1. Create a Feishu custom app and get:
   - `CTI_FEISHU_APP_ID`
   - `CTI_FEISHU_APP_SECRET`
2. Set your runtime in `~/.claude-to-im/config.env`, for example:

```env
CTI_RUNTIME=codex
CTI_ENABLED_CHANNELS=feishu
CTI_DEFAULT_WORKDIR=/path/to/your/project
CTI_FEISHU_APP_ID=cli_xxx
CTI_FEISHU_APP_SECRET=xxx
CTI_FEISHU_DOMAIN=https://open.feishu.cn
```

3. In Feishu Open Platform:
   - batch-add the required bot/message/card permissions
   - enable the **Bot** feature
   - publish and approve the first version
   - use this permission JSON for batch-add:

```json
{
  "scopes": {
    "tenant": [
      "im:message:send_as_bot",
      "im:message:readonly",
      "im:message.p2p_msg:readonly",
      "im:message.group_at_msg:readonly",
      "im:message:update",
      "im:message.reactions:read",
      "im:message.reactions:write_only",
      "im:chat:read",
      "im:resource",
      "cardkit:card:write",
      "cardkit:card:read"
    ],
    "user": []
  }
}
```
4. Start the bridge:

```bash
bash scripts/daemon.sh start
```

5. Go back to Feishu Open Platform and configure:
   - event dispatch method: **Long Connection**
   - event: `im.message.receive_v1`
   - callback: `card.action.trigger`
6. Publish and approve again
7. Send `hello` to the bot in Feishu and confirm it replies

If you use Codex on Azure, make sure `AZURE_OPENAI_API_KEY` is available to the daemon environment before starting the bridge.

## Commands

All commands are run inside Claude Code or Codex:

| Claude Code | Codex (natural language) | Description |
|---|---|---|
| `/claude-to-im setup` | "claude-to-im setup" / "配置" | Interactive setup wizard |
| `/claude-to-im start` | "start bridge" / "启动桥接" | Start the bridge daemon |
| `/claude-to-im stop` | "stop bridge" / "停止桥接" | Stop the bridge daemon |
| `/claude-to-im status` | "bridge status" / "状态" | Show daemon status |
| `/claude-to-im logs` | "查看日志" | Show last 50 log lines |
| `/claude-to-im logs 200` | "logs 200" | Show last 200 log lines |
| `/claude-to-im reconfigure` | "reconfigure" / "修改配置" | Update config interactively |
| `/claude-to-im doctor` | "doctor" / "诊断" | Diagnose issues |

## Platform Setup Guides

The `setup` wizard provides inline guidance for every step. Here's a summary:

### Telegram

1. Message `@BotFather` on Telegram → `/newbot` → follow prompts
2. Copy the bot token (format: `123456789:AABbCc...`)
3. Recommended: `/setprivacy` → Disable (for group use)
4. Find your User ID: message `@userinfobot`

### Discord

1. Go to [Discord Developer Portal](https://discord.com/developers/applications) → New Application
2. Bot tab → Reset Token → copy it
3. Enable **Message Content Intent** under Privileged Gateway Intents
4. OAuth2 → URL Generator → scope `bot` → permissions: Send Messages, Read Message History, View Channels → copy invite URL

### Feishu / Lark

1. Go to [Feishu Open Platform](https://open.feishu.cn/app) (or [Lark](https://open.larksuite.com/app))
2. Create Custom App → get App ID and App Secret
3. **Batch-add permissions**: go to "Permissions & Scopes" → use batch configuration to add all required scopes (the `setup` wizard provides the exact JSON)
4. Required Feishu permissions for this repo are:
   - `im:message:send_as_bot`
   - `im:message:readonly`
   - `im:message.p2p_msg:readonly`
   - `im:message.group_at_msg:readonly`
   - `im:message:update`
   - `im:message.reactions:read`
   - `im:message.reactions:write_only`
   - `im:chat:read`
   - `im:resource`
   - `cardkit:card:write`
   - `cardkit:card:read`
5. Enable Bot feature under "Add Features"
6. **Events & Callbacks**: select **"Long Connection"** as event dispatch method → add `im.message.receive_v1` event and `card.action.trigger` callback
7. **Publish**: go to "Version Management & Release" → create version → submit for review → approve in Admin Console
8. **Important**: The bot will NOT work until the version is approved and published

### QQ

> QQ currently supports **C2C private chat only**. No group/channel support, no inline permission buttons, no streaming preview. Permissions use text `/perm ...` commands. Image inbound only (no image replies).

1. Go to [QQ Bot OpenClaw](https://q.qq.com/qqbot/openclaw)
2. Create a QQ Bot or select an existing one → get **App ID** and **App Secret** (only two required fields)
3. Configure sandbox access and scan QR code with QQ to add the bot
4. `CTI_QQ_ALLOWED_USERS` takes `user_openid` values (not QQ numbers) — can be left empty initially
5. Set `CTI_QQ_IMAGE_ENABLED=false` if the underlying provider doesn't support image input

## Architecture

```
~/.claude-to-im/
├── config.env             ← Credentials & settings (chmod 600)
├── data/                  ← Persistent JSON storage
│   ├── sessions.json
│   ├── bindings.json
│   ├── permissions.json
│   └── messages/          ← Per-session message history
├── logs/
│   └── bridge.log         ← Auto-rotated, secrets redacted
└── runtime/
    ├── bridge.pid          ← Daemon PID file
    └── status.json         ← Current status
```

### Key components

| Component | Role |
|---|---|
| `src/main.ts` | Daemon entry — assembles DI, starts bridge |
| `src/config.ts` | Load/save `config.env`, map to bridge settings |
| `src/store.ts` | JSON file BridgeStore (30 methods, write-through cache) |
| `src/llm-provider.ts` | Claude Agent SDK `query()` → SSE stream |
| `src/codex-provider.ts` | Codex SDK `runStreamed()` → SSE stream, with direct Codex CLI fallback |
| `src/sse-utils.ts` | Shared SSE formatting helper |
| `src/permission-gateway.ts` | Async bridge: SDK `canUseTool` ↔ IM buttons |
| `src/logger.ts` | Secret-redacted file logging with rotation |
| `scripts/daemon.sh` | Process management (start/stop/status/logs) |
| `scripts/doctor.sh` | Health checks |
| `SKILL.md` | Claude Code skill definition |

### Permission flow

```
1. Claude wants to use a tool (e.g., Edit file)
2. SDK calls canUseTool() → LLMProvider emits permission_request SSE
3. Bridge sends inline buttons to IM chat: [Allow] [Deny]
4. canUseTool() blocks, waiting for user response (5 min timeout)
5. User taps Allow → bridge resolves the pending permission
6. SDK continues tool execution → result streamed back to IM
```

## Troubleshooting

Run diagnostics:

```
/claude-to-im doctor
```

This checks: Node.js version, config file existence and permissions, token validity (live API calls), log directory, PID file consistency, and recent errors.

| Issue | Solution |
|---|---|
| `Bridge won't start` | Run `doctor`. Check if Node >= 20. Check logs. |
| `Messages not received` | Verify token with `doctor`. Check allowed users config. |
| `Permission timeout` | User didn't respond within 5 min. Tool call auto-denied. |
| `Stale PID file` | Run `stop` then `start`. daemon.sh auto-cleans stale PIDs. |

See [references/troubleshooting.md](references/troubleshooting.md) for more details.

## Security

- All credentials stored in `~/.claude-to-im/config.env` with `chmod 600`
- Tokens are automatically redacted in all log output (pattern-based masking)
- Allowed user/channel/guild lists restrict who can interact with the bot
- The daemon is a local process with no inbound network listeners
- See [SECURITY.md](SECURITY.md) for threat model and incident response

## Development

```bash
npm install        # Install dependencies
npm run dev        # Run in dev mode
npm run typecheck  # Type check
npm test           # Run tests
npm run build      # Build bundle
```

## Publish Notes

- `config.env` is intentionally ignored and should never be committed
- Public installs should use `config.env.example` as the starting point
- On macOS, `scripts/supervisor-macos.sh` forwards runtime env vars into launchd so Codex on Azure / Azure Foundry-backed Codex can run in the background

## License

[MIT](LICENSE)
