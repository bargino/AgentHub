# AgentHub - IM 式多 Agent 软件开发协作平台

以聊天会话为交互入口，以 Orchestrator 编排器为调度核心，以统一 Agent Adapter 为执行抽象层的多智能体协作平台。用户像在群聊中安排同事一样，通过 `@planner`、`@coder`、`@reviewer` 等指令调度 AI Agent，完成需求拆解、代码修改、Diff 审核、网页预览与部署确认的端到端闭环。

## 项目结构

```
Multi-Agent/
├── agenthub/            # 桌面客户端（Electron + React 19 + TypeScript + Tailwind 4 + Zustand）
│   └── src/
│       ├── main/        # Electron 主进程（后端进程管理 / IPC / 窗口状态持久化）
│       ├── preload/     # 预加载脚本（backend.status / backend.restart IPC 桥）
│       └── renderer/    # 渲染进程（IM 界面）
│           └── src/
│               ├── components/   # IconNav / ConversationList / ChatWindow / TaskPanel /
│               │                 # DiffViewer / ApprovalModal / PreviewPanel / AgentsPage / SettingsPage
│               ├── services/     # http.ts（REST）/ websocket.ts（实时事件）/ api.ts（API 门面）
│               ├── store/        # Zustand 全局状态（WS 事件驱动）
│               └── types/        # 领域类型（与后端 camelCase JSON 直接对齐）
│
└── agenthub-server/     # 后端（FastAPI + SQLAlchemy 2.0 async + SQLite）
    ├── app/
    │   ├── adapters/    # 统一 Agent 适配层（ICodeAdapter 接口）
    │   │   ├── mock/         # MockAdapter：无 Key 全流程演示（流式/工具/Diff/审批）
    │   │   ├── generic_llm/  # GenericLLMAdapter：OpenAI 兼容 API（Planner/Reviewer/编排用）
    │   │   ├── claude_code/  # ClaudeCodeAdapter：真实代码执行（需 claude-agent-sdk）
    │   │   └── codex/        # CodexAdapter：真实代码执行（需 openai-codex）
    │   ├── orchestrator/  # 编排引擎：task_planner（LLM 规划+规则回退）/ task_executor（DAG 并行）/
    │   │                  # agent_router（角色->适配器路由）/ context_builder / prompts
    │   ├── memory/        # 三层记忆：conversation（滑动窗口）/ task（任务链）/ project（长期知识）/ summary（溢出滚动压缩）
    │   ├── security/      # command_whitelist（白名单三级判定）/ permission_manager / approval_manager
    │   ├── services/      # conversation / message / task / diff / approval / workspace / preview / deploy / event_store
    │   ├── api/
    │   │   ├── v1/        # REST 路由（会话/消息/任务/Diff/审批/Agent/预览/部署/事件）
    │   │   └── ws/        # WebSocket /ws/session（subscribe / send_message + 事件推送）
    │   ├── core/          # event_bus（服务->传输解耦）/ registry / message_handler
    │   ├── db/            # SQLite 引擎 + ORM 模型（数据存 ~/.agenthub/data.db）
    │   └── schemas.py     # 业务 API 契约（camelCase 序列化）
    ├── config/adapters.yaml   # 适配器开关与配置
    └── tests/smoke_e2e.py     # 端到端冒烟测试
```

## 快速开始

### 1. 启动后端

```bash
cd agenthub-server
pip install "sqlalchemy[asyncio]" aiosqlite httpx fastapi "uvicorn[standard]" pydantic pydantic-settings pyyaml python-dotenv websockets
python -m uvicorn app.main:app --host 127.0.0.1 --port 8642
```

无需任何 API Key 即可运行：编排引擎自动回退到规则模板任务链（planner -> coder -> reviewer），Agent 执行走 MockAdapter 完整模拟。

可选配置（`.env`，参考 `.env.example`）：

| 变量 | 说明 |
|---|---|
| `AGENTHUB_LLM_BASE_URL` | OpenAI 兼容 API 地址（如 DeepSeek/Moonshot/Ollama） |
| `AGENTHUB_LLM_API_KEY` | LLM API Key（配置后 Orchestrator/Planner/Reviewer 用真实 LLM） |
| `AGENTHUB_LLM_MODEL` | 默认模型名 |
| `AGENTHUB_DATA_DIR` | 数据目录（默认 `~/.agenthub`） |

### 2. 启动桌面端

```bash
cd agenthub
npm install
npm run dev
```

Electron 主进程启动时会自动检测 8642 端口：后端未运行则自动 spawn `uvicorn` 子进程。

### 3. 验证

```bash
cd agenthub-server
python tests/smoke_e2e.py   # 端到端冒烟（需后端已启动）
```

## 核心流程

1. 用户在会话中输入需求（可 `@agent` 直接路由，默认走 Orchestrator）
2. Orchestrator 生成结构化任务计划（LLM JSON 模式 + DAG 校验，失败回退规则模板）
3. DAG 执行器拓扑调度：无依赖任务并行，每任务经 agent_router 路由到适配器
4. 适配器 UnifiedEvent 流转换为业务事件：流式消息（message.delta）/ 工具调用 / Diff（diff.generated）/ 审批（approval.required）
5. 审批门控：前端弹窗 -> REST 决策 -> DB 落库 + 适配器回传解除执行阻塞
6. Diff 审批通过 -> workspace `git commit` 推进基线；拒绝 -> `git reset --hard` 回滚
7. 全部 AgentEvent 持久化到 event store，支持按会话查询回放

## 安全模型（PRD §10）

- Workspace 隔离：每会话独立目录 `~/.agenthub/workspaces/{id}` + 独立 git 仓库
- 命令白名单三级判定：ALLOWED（npm/pnpm 开发命令）/ NEEDS_APPROVAL（非白名单）/ BLOCKED（rm -rf、sudo、管道远程脚本等）
- 操作权限策略：删文件/装依赖/应用 Diff/部署必须审批；敏感配置默认禁止
- 路径越界检查：所有文件操作限制在 workspace 内

## API 摘要

REST Base：`http://127.0.0.1:8642/api/v1`

| 端点 | 说明 |
|---|---|
| `GET /health` | 健康检查 + 适配器状态 |
| `POST/GET /conversations` | 会话创建 / 列表 |
| `GET /conversations/:id/{messages,tasks,diff,approval,events}` | 会话子资源 |
| `POST /diffs/:id/{approve,reject}` | Diff 审批（联动 workspace commit/rollback） |
| `POST /approvals/:id/resolve` | 动作审批（联动适配器解除阻塞） |
| `POST /tasks/:id/retry` | 失败任务重试 |
| `GET /agents` | Agent 注册表（角色/适配器/能力） |
| `POST /conversations/:id/preview/start` | 启动 dev server 预览 |
| `POST /conversations/:id/deployments` + `/deployments/:id/approve` | 部署计划 + 审批执行（V1 Mock） |

WebSocket：`ws://127.0.0.1:8642/ws/session`，动作 `subscribe` / `send_message` / `pong`；服务端推送 `message.delta` / `message.completed` / `task.status.changed` / `diff.generated` / `approval.required` / `approval.resolved` / `conversation.updated` / `preview.*` / `deploy.*` / `error`。

## 开发命令

```bash
# 前端
cd agenthub
npm run dev          # 开发模式
npm run typecheck    # 类型检查（node + web）
npm run lint         # ESLint
npm run build:win    # Windows 打包

# 后端
cd agenthub-server
python -m uvicorn app.main:app --reload   # 开发模式
python tests/smoke_e2e.py                 # 冒烟测试
```

## Codex 适配器（真实执行）

`CodexAdapter` 基于 `openai-codex` SDK 底层 `CodexClient`（app-server JSON-RPC 协议）实现，已实测验证：

- 人工审批门控：`approval_handler` 回调桥接审批弹窗，`accept`/`decline` 决策实测生效
- 白名单前置：命令审批先过 `command_whitelist` 三级判定（ALLOWED 自动放行 / BLOCKED 自动拦截 / 其余人工审批）
- 事件映射：`item/agentMessage/delta`（流式）/ `item/started|completed`（工具与补丁）/ `turn/diff/updated`（聚合 diff）/ `turn/completed`
- 隔离模型：每次执行独立 `CodexClient` 子进程（借鉴 CodexMonitor worktree-per-agent 思路）
- 依赖：`pip install openai-codex`（含 pinned CLI runtime），需 Codex 登录态（API Key 或 ChatGPT）

Workspace 隔离支持 git worktree 模式：`source_project` 为 git 仓库时用 `git worktree add` 建会话分支（免复制、共享对象库、agent 分支可直接 merge 回源仓库），非 git 源回退为复制目录 + 独立仓库。

## Per-Agent 模型与 API 供应商（参照 cc-switch 增强）

每个 Agent 可在「Agent 管理」页独立配置模型与 API 供应商，互不影响、并行不串：

- **模型**：留空走 SDK 默认；填写后经 `ClaudeAgentOptions.model` / Codex wire `model` 参数生效
- **API 供应商（可选）**：`Base URL` + `API Key`，留空走本地 SDK 登录态；填写后仅注入该 Agent 的 SDK 子进程：
  - Claude Code：子进程 env `ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN`（与继承环境合并）
  - Codex：子进程 env `OPENAI_API_KEY` + `config_overrides` 定义独立 provider（等价 CLI `-c model_providers.*`，`wire_api=chat`）
- 与 cc-switch 写 `~/.claude/settings.json`、`~/.codex/config.toml` 的全局切换不同，本实现不碰任何全局配置文件，每个 Agent 子进程独立注入，天然支持多 Agent 混用不同供应商
- 配置存储于本地 SQLite（`~/.agenthub/data.db`，明文，与 cc-switch 同等安全级别）

## Rules / Skills / MCP 支持

像 Claude Code、Codex 一样支持全局与工作空间级规则、技能与 MCP：

| 层 | 机制 | 配置位置 |
|---|---|---|
| Claude Code 原生 | `setting_sources: [user, project]` 加载 `~/.claude`（CLAUDE.md / settings / skills）与 workspace 内项目级 `CLAUDE.md` / `.claude/`；`skills: all` 启用技能 | `config/adapters.yaml` claude-code 段 |
| Codex 原生 | app-server 子进程天然加载 `~/.codex/config.toml` 与按 cwd 层级的 `AGENTS.md`（workspace 复制 / worktree 自动带入项目内文件） | `~/.codex/` 即生效 |
| 统一 MCP | 一份 `config/mcp.yaml`（字段对齐标准 mcp.json）双端生效：claude-code 直传 SDK `mcp_servers`（并按 `mcp__<name>` 放行工具），codex 转 `-c mcp_servers.<name>.*` 配置覆盖 | `config/mcp.yaml` |
| AgentHub 自有规则 | `~/.agenthub/rules.md`（全局）+ 项目根 `AGENTHUB.md`（工作区）注入所有执行器的指令前缀，对 generic-llm / mock 也生效 | 两个 md 文件 |

## 项目群聊（会话 = 微信群）

每个会话即一个项目群聊，群有自己的成员、规则与技能配置（后端 `Conversation.member_agent_ids / rules / settings`，空成员 = 全员）：

| 能力 | 入口 | 说明 |
|---|---|---|
| 邀请群成员 | 新建项目弹窗（两条路径均可） | Agent 多选，默认全选；全选 = 全员语义，之后新建的 Agent 自动入群 |
| 成员管理 | 聊天窗顶栏成员头像堆叠 / 「群设置」按钮 | 头像 hover 移除、「+」邀请；Orchestrator 锁定不可移除；成员补齐至全部启用 Agent 时自动归一为「全员」 |
| 群规则 | 群设置抽屉 | 文本注入该会话所有任务指令（排在全局 / 项目规则之后） |
| 群技能 | 群设置抽屉 | 四态：跟随全局 / 全部加载 / 自定义列表 / 关闭，透传 claude-code 适配器 |
| 成员过滤 | 输入框 @联想、消息路由、任务规划 | 全链路只在群成员内解析（前后端同口径） |
| 归档会话 | 群设置抽屉危险区 | 两段式确认，归档后移出会话列表 |

## 文件面板（workspace 文件树 + Git 视图）

聊天窗工具栏常驻「文件」按钮，打开右侧面板（与任务 / 群设置面板互斥），基于会话 workspace 的只读 git 端点（`/git/status|diff|log`）：

- **变更**：未提交文件按目录分组成树，M / A / U / D / R 状态徽标 + 当前分支名
- **Diff**：对照 HEAD 的全量 unified diff（行级着色，含未跟踪文件），不依赖审批记录随时可看
- **提交**：提交历史（短 hash / 标题 / 作者 / 相对时间）

注意：workspace 在会话**首次执行任务**时才创建，此前面板显示「工作区尚未创建」引导。审批式 Diff 视图（批准 / 拒绝 / 要求修改）仍走原「Diff」按钮，仅在产生代码变更任务后出现。

## 动态上下文窗口

会话记忆预算按该 Agent 实际模型的上下文窗口动态换算（`app/memory/conversation_memory.py:window_profile`）：

- 模型名前缀匹配上下文窗口（claude 200K / gpt-5 400K / gemini 1M / deepseek 128K 等，未知模型保守 128K）
- 记忆字符预算 = 窗口 token x 15% x 2 字符/token，区间 [12K, 64K]；单条消息截断上限同步伸缩
- 窗口条数恒为 30 条，与摘要滚动压缩边界共口径，无盲区

## 当前版本边界（V1）

- Deploy 为 Mock 实现（生成计划 + 审批 + 模拟执行记录日志），不做真实云部署
- ClaudeCode 适配器需额外安装对应 SDK 才会启用，缺失时自动跳过并回退 mock；Codex 适配器需 `openai-codex`（beta，升级时建议复跑 `Desktop/codex-sdk-test` 回归脚本）
- Preview 仅支持 npm/Vite 系项目（白名单命令）
- 设置页不再提供全局 API Key 配置；模型与供应商按 Agent 维度在「Agent 管理」页配置（Orchestrator/Planner 等纯文本规划仍走 `.env` 的 `AGENTHUB_LLM_*`）
