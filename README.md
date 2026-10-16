# dsh-trae-api (Trae Local API)

将 Trae Work CN 的**积分/额度**转化为本地 OpenAI/Anthropic 兼容 API 服务，让 Claude Code、Cursor、Cline、Windsurf 等第三方 AI 编程工具直接调用 Trae 底层模型（GLM、DeepSeek、Qwen、Kimi、MiniMax 等）。

本项目是一个 **DeepSeek Harness (DSH) 插件**，安装后随 `dsh` 启动自动运行代理服务；也可以独立运行。

## 原理

1. 本机已安装并登录 Trae Work CN（或 TRAE SOLO CN / Trae SG / TRAE SOLO）
2. 脚本自动从本地 `storage.json` 中解密认证 Token
3. 启动本地 Express 服务器，提供 OpenAI/Anthropic 兼容的 API 端点
4. 第三方 Agent 将请求发送到本地服务器，本地服务器转发到 Trae 上游 API
5. **消耗的是 Trae 的积分，无需额外付费**

## 支持的平台

Windows / macOS / Linux 均可运行，脚本会自动定位当前系统的 Trae 数据目录。

| 平台 | Trae 数据目录 | 认证文件 | 一键启动 |
|------|---------------|----------|----------|
| Windows | `%APPDATA%\<产品名>` | `%APPDATA%\<产品名>\User\globalStorage\storage.json` | `start.bat` |
| macOS | `~/Library/Application Support/<产品名>` | 同上，`.../User/globalStorage/storage.json` | `./start.sh` |
| Linux | `$XDG_CONFIG_HOME/<产品名>`（默认 `~/.config/<产品名>`） | 同上，`.../User/globalStorage/storage.json` | `./start.sh` |

其中 `<产品名>` 由 Trae 版本决定：`Trae CN`、`TRAE SOLO CN`、`Trae`、`TRAE SOLO`。

例如在 Linux 上安装 Trae CN 时，认证文件位于：

```
~/.config/Trae CN/User/globalStorage/storage.json
```

若 Trae 的数据目录不在上述默认位置（自定义安装、重打包、Flatpak/Snap 等），用 `TRAE_DATA_DIR` 显式指定，或依赖自动扫描兜底。

## 支持的 Trae 版本

| 版本 | IDE 名称 | 数据目录 | 上游端点 |
|------|----------|----------|----------|
| `cn` | Trae CN 国内版 | `Trae CN` | `trae-api-cn.mchost.guru` |
| `solo` | TRAE SOLO CN 独立部署版 | `TRAE SOLO CN` | `trae-api-cn.mchost.guru` |
| `sg` | Trae 国际版 | `Trae` | `a0ai-api-sg.byteintlapi.com` |
| `solo-sg` | TRAE SOLO 国际版 | `TRAE SOLO` | `a0ai-api-sg.byteintlapi.com` |

## 功能

- 自动解密四版本认证数据，无需手动配置 Token
- 跨平台自动定位 Trae 数据目录（Windows / macOS / Linux）
- 提供 OpenAI (`/v1/chat/completions`) 和 Anthropic (`/v1/messages`) 兼容接口
- 支持 OpenAI Responses API (`/v1/responses`)
- Token 过期自动刷新，自动保存到 `.env`
- 支持流式输出 (SSE)
- 完整支持 Claude Code 工具调用
- 3 级 API 端点回退机制
- 上下文窗口自动截断，避免超出 Token 限制

## 前置条件

- **Node.js >= 18**（内置 `fetch` 支持）
- **已安装并登录**以下任一 Trae IDE：Trae CN、TRAE SOLO CN、Trae（国际版）、TRAE SOLO（国际版）

## 快速开始

### 方式 A：作为 DSH 插件安装（推荐）

```bash
# 安装到 web profile
dsh plugin --profile web add dsh-trae-api
# 重启 dsh 使插件生效
dsh web
```

插件启动后，代理服务自动运行在 `http://localhost:9220`。

卸载：
```bash
dsh plugin --profile web remove dsh-trae-api
```

### 方式 B：独立运行

```bash
npm install
```

首次运行需要解密本机 Trae 的认证数据并写入 `.env`：

```bash
npm run setup      # 等价于 node setup.cjs
```

然后启动服务：

```bash
npm start
```

也可以直接用一键脚本完成「首次 setup + 启动」：

```bash
./start.sh         # Linux / macOS
start.bat          # Windows
```

首次运行会自动从本机 Trae IDE 的 `storage.json` 解密认证数据并保存到 `.env`，之后直接读取 `.env` 启动。

> 注意：`setup` 脚本的文件名是 `setup.cjs`。项目 `package.json` 声明了 `"type": "module"`，
> 如果把它改回 `setup.js`，Node 会按 ES Module 解析并报
> `ReferenceError: require is not defined in ES module scope`。

### 连接第三方 Agent

**Claude Code（Linux / macOS）：**
```bash
export ANTHROPIC_BASE_URL="http://localhost:9220"
export ANTHROPIC_API_KEY="trae-local-api"
claude
```

**Claude Code（Windows PowerShell）：**
```powershell
$env:ANTHROPIC_BASE_URL = "http://localhost:9220"
$env:ANTHROPIC_API_KEY = "trae-local-api"
claude
```

**Cursor / Cline / Windsurf：** 配置 OpenAI Compatible Provider，Base URL 为 `http://localhost:9220/v1`，API Key 为 `trae-local-api`。

**Python (OpenAI SDK)：**
```python
from openai import OpenAI
client = OpenAI(base_url="http://localhost:9220/v1", api_key="trae-local-api")
response = client.chat.completions.create(
    model="auto",
    messages=[{"role": "user", "content": "Hello!"}],
    stream=True
)
```

## API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/v1/status` | 服务状态 |
| GET | `/v1/models` | 模型列表 |
| POST | `/v1/chat/completions` | OpenAI 格式对话 |
| POST | `/v1/messages` | Anthropic 格式对话 |
| POST | `/v1/messages/count_tokens` | 估算 Token 数 |
| POST | `/v1/responses` | OpenAI Responses API |

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `TRAE_EDITION` | Trae 版本 (cn/solo/sg/solo-sg) | cn |
| `TRAE_DATA_DIR` | 手动指定 Trae 数据目录（可指向 `<产品名>` 目录或其中的 `User` 目录） | 自动探测 |
| `TRAE_DEVICE_TYPE` | 覆盖请求头 `x-device-type` | 按平台自动（linux/mac/windows） |
| `TRAE_OS_VERSION` | 覆盖请求头 `x-os-version` | 按平台自动 |
| `API_KEY` | 本服务的 API Key | trae-local-api |
| `PORT` | 监听端口 | 9220 |
| `HOST` | 监听地址 | 127.0.0.1 |
| `MAX_CONTEXT_TOKENS` | 最大上下文 Token 数 | 200000 |

> 完整环境变量列表见 `.env.example`

## 常见问题

**`setup` 报 `require is not defined in ES module scope`**

说明你用的是旧版 `setup.js`。请改用 `setup.cjs`（本仓库已修复）。

**提示找不到 `storage.json`**

1. 确认 Trae IDE 已安装且已登录；
2. 查看 `npm run setup` 输出的「Searched roots」，确认搜索路径；
3. 若数据目录不在默认位置，手动指定：

```bash
TRAE_DATA_DIR="/path/to/Trae CN" npm run setup
```

**`/v1/status` 显示 `has_token: false`**

说明没有成功读取认证数据。重新执行 `npm run setup`，或在 `.env` 中手动设置 `TRAE_MANUAL_TOKEN`。

## 已知问题

**上游接口可能对部分模型返回 `3003`，表现为回复内容为空**（与操作系统无关）

截至 2026-10-16 实测，`/api/agent/v3/llm_utils_chat` 对 `glm-5.2` 等模型返回：

```
{"code":3003,"message":"model service is unavailable ... InvalidParameter:
 Invalid combination of reasoning_effort and thinking type: high + disabled"}
```

这是 Trae 上游对 `reasoning_effort` 与 `thinking` 组合的校验失败。代理拿到的是
HTTP 200（错误在 SSE 事件里），因此会被当成成功，最终返回空内容。
Windows / macOS / Linux 表现一致，与本次平台适配无关，可参考上游 issue
[#3](https://github.com/Wang-JQ77/dsh-trae-api/issues/3)、
[#4](https://github.com/Wang-JQ77/dsh-trae-api/issues/4)。

排查建议：先用 `curl http://127.0.0.1:9220/v1/status` 确认 `has_token: true`
（鉴权正常），再确认是否是该上游问题。

## 注意事项

- 本工具仅在你**已经拥有 Trae 积分**的情况下有效，本质上是将 Trae 的 API 额度通过本地代理暴露为标准接口
- 默认仅监听 `127.0.0.1`，局域网与公网无法访问
- 默认启用 API Key 鉴权（默认值 `trae-local-api`，建议修改）
- 请勿将 `.env` 文件提交到版本控制（已在 `.gitignore` 中忽略）

## 免责声明

本工具仅供学习和研究使用。使用本工具调用 Trae API 所产生的费用和合规问题由用户自行承担。请遵守 Trae 平台的使用条款。

## License

MIT
