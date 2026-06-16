<div align="center">

# AgentHub

**多 AI Agent 协作编码引擎 · Multi-Agent Collaborative Coding Engine**

以「群聊」组织 Planner / Coder / Reviewer / Deployer 等角色 Agent，协同完成端到端编码任务。

[![Python](https://img.shields.io/badge/Python-3.11-3776AB?logo=python&logoColor=white)](https://www.python.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Electron](https://img.shields.io/badge/Electron-React%2019-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-async-009688?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](#-license)

[特性](#-特性) · [架构](#-架构) · [快速开始](#-快速开始) · [配置](#-配置) · [开发](#-开发) · [路线图](#-路线图)

</div>

---

## 📖 简介

**AgentHub** 是一款多 AI Agent 协作编码桌面应用。不同于「一个对话框 + 一个大模型」的传统形态，它把编码流程拆成可协作的角色 Agent，由一套自研编排引擎统一调度：

- **规划者（Planner）** 把复杂需求拆解为带依赖的任务图；
- **编码者（Coder）** 在隔离的工作区中实现具体任务；
- **审查者（Reviewer）** 对产出裁决，必要时触发修复或重规划；
- **部署者（Deployer）** 执行高危操作，并强制走人工审批闸门。

底层通过**统一适配器层**对接 [Claude Agent SDK](https://docs.anthropic.com/) 与 [OpenAI Codex SDK](https://openai.com/)，编排逻辑与具体模型解耦；客户端经**进程内 stdio 桥**驱动后端引擎，**不监听任何网络端口**，攻击面小、便于随桌面应用一体分发。

> 本仓库是一个 **monorepo**：桌面客户端（`agenthub/`）与编排引擎（`agenthub-server/`）两个同级子项目，由一条 stdio 桥连接、一并打包分发。

---

## ✨ 特性

| 能力 | 说明 |
| --- | --- |
| 🔀 **意图分流** | `direct / single / pipeline` 三级分流，一次大模型调用完成「判意图 + 简单问题直接作答」，简单请求调用次数约 **−75%**，判断失败回退单步执行。 |
| 🕸️ **任务编排（DAG）** | 复杂需求拆为带依赖的任务图；提交前校验依赖合法且无环，执行期按依赖分批调度、无依赖并行、失败级联取消、已完成断点续跑，死锁态兜底。 |
| 🧠 **三层记忆** | 短期（会话）/ 中期（任务间结果）/ 长期（跨会话项目知识）；按真实 token 占用比例分级动态调节注入预算，历史超窗滚动压缩为结构化摘要。 |
| 🔌 **统一适配器** | 统一执行接口 + 统一事件流（思考 / 工具调用 / 审批 / 代码改动 / 完成 / 错误）；按健康检查在 Claude → Codex → Mock 间自动降级，支持 per-agent 独立供应商与会话 resume。 |
| 🧭 **结构化能力路由** | 借鉴 A2A *Agent Card*，Agent 能力可声明为结构化清单（何时该派 / 不该派 / 输入输出 / 示例），渲染进规划提示，路由更准；未声明时回退自由文本，向后兼容。 |
| 🛡️ **审批与安全闸门** | 审批协调器打通「界面审批」与「Agent 执行阻塞点」并持久化，重启后仍可解除、失败置任务 failed 并提示；高危操作经命令白名单 + 权限策略推导风险等级并二次确认，路径围栏防越权写。 |
| 🔧 **工具接入（MCP）** | 支持本地 stdio / 远程 HTTP 两类 MCP 服务器，按 Agent 能力白名单下发可用工具。 |
| 🖥️ **流式审查 UI** | 流式增量渲染 + 乐观更新；并排 / 行内 Diff、语法高亮与完整文件上下文、多 Agent 向导式逐项审批。 |

---

## 🏗️ 架构

```mermaid
flowchart TB
    subgraph Desktop["agenthub · 桌面客户端 (Electron)"]
        R["Renderer<br/>React 19 · Zustand<br/>聊天 / Diff 审查 / 任务面板 / 审批"]
        M["Main Process<br/>stdio 桥 · 超时 / 崩溃重启 / 熔断"]
        R <-->|IPC| M
    end

    subgraph Server["agenthub-server · 编排引擎 (Python)"]
        B["stdio 桥入口<br/>python -m app.bridge"]
        O["Orchestrator<br/>意图分流 · 任务规划(DAG) · 调度 · 记忆 · prompt"]
        A["统一适配器层<br/>claude_code / codex / mock"]
        S["安全域<br/>审批协调 · 命令白名单 · 权限策略 · 路径围栏"]
        B --> O --> A
        O --> S
    end

    M <==>|NDJSON 帧<br/>stdio，无网络端口| B
    A -.->|Claude Agent SDK| LLM1["Claude"]
    A -.->|OpenAI Codex SDK| LLM2["Codex"]
    A -.->|MCP| TOOLS["工具 / 数据源"]
```

数据流（一次请求）：渲染层 → IPC → 主进程 stdio 桥 → 后端桥入口 → 编排器**意图分流**判定 → （多步则）规划为**任务 DAG** → 调度器按依赖执行 → 各任务经**统一适配器**驱动底层 SDK，事件以统一事件流回传 → 高危动作进**审批闸门** → 结果与 Diff 流式回渲染层审查。

---

## 📂 项目结构

```
.
├── agenthub/                    # 桌面客户端（前端 + Electron 主进程）
│   ├── src/
│   │   ├── main/                # 主进程：拉起后端、stdio 桥、IPC
│   │   │   ├── bridge.ts            # spawn `python -m app.bridge`，NDJSON 收发 / 超时 / 重启 / 熔断
│   │   │   └── serverEnv.ts         # 解析后端目录与 Python 解释器（支持 AGENTHUB_PYTHON）
│   │   ├── preload/             # 预加载脚本（contextBridge 暴露受限 API）
│   │   └── renderer/            # React 渲染层（聊天 / Diff 审查 / 任务面板 / 审批向导）
│   ├── electron-builder.yml     # 打包配置
│   └── package.json
│
├── agenthub-server/             # 编排引擎 / 适配器层（后端）
│   ├── app/
│   │   ├── bridge.py            # stdio 桥入口
│   │   ├── api/                 # 进程内 ASGI 路由（agents / tasks / approvals / git ...）
│   │   ├── orchestrator/        # 意图分流 · 任务规划(DAG) · 调度执行 · 记忆 · prompt 构建
│   │   ├── adapters/            # 统一适配器：claude_code / codex / mock
│   │   ├── security/            # 审批协调 · 命令白名单 · 权限策略 · 路径围栏
│   │   ├── services/            # diff 构建 · git 面板 · 任务 / 审批服务
│   │   ├── db/                  # SQLAlchemy 模型 · 引擎与轻量迁移
│   │   └── schemas.py           # 对外数据契约（Pydantic，camelCase 出入）
│   ├── agents/                  # 角色定义（*.md，首启 seed 进 DB）
│   ├── config/                  # adapters.yaml / mcp.yaml
│   ├── tests/                   # pytest 用例
│   └── pyproject.toml
│
├── docs/                        # 设计文档与分析材料
└── README.md
```

---

## 🚀 快速开始

### 前置要求

- **Node.js** ≥ 18（建议 20 LTS）+ npm
- **Python** 3.11
- **Conda**（推荐）：后端依赖默认装在名为 `agent` 的 conda 环境；客户端按 `conda info --base` 下的 `envs/agent` 定位解释器。不用 conda 时用环境变量 `AGENTHUB_PYTHON` 指向任意可用 python。
- 至少一个 Agent SDK（`claude-agent-sdk` 或 `openai-codex`）；运行时自动探测可用性，均不可用时降级到 **Mock**。

### 1️⃣ 后端（agenthub-server）

```bash
cd agenthub-server

# 推荐：conda（与客户端默认解释器解析一致）
conda create -n <env> python=3.11 -y && conda activate <env>
pip install poetry && poetry install --extras all     # 或：pip install -e ".[all]"
```

> `--extras all` 同装 Claude + Codex SDK；只装其一可用 `--extras claude` 或 `--extras codex`。

### 2️⃣ 客户端（agenthub）

```bash
cd agenthub
npm install

# 若后端不在默认 conda `agent` 环境，先指定解释器：
#   macOS/Linux : export AGENTHUB_PYTHON=/path/to/python
#   Windows     : $env:AGENTHUB_PYTHON="C:\path\to\python.exe"

npm run dev          # 启动开发态客户端；会自动拉起后端 stdio 桥
```

### 📦 构建打包

打包由 `agenthub/` 下的 electron-builder 完成，后端作为 `resources/agenthub-server` 一并打进应用：

```bash
cd agenthub
npm run build:win    # Windows 安装包
npm run build:mac    # macOS dmg
npm run build:linux  # Linux AppImage / snap / deb
```

> 运行期后端目录：开发期取仓库同级 `../agenthub-server`，打包后取 `process.resourcesPath/agenthub-server`（见 `src/main/serverEnv.ts`）。打包产物仍依赖目标机器上可用的 Python 环境。

---

## ⚙️ 配置

后端配置经环境变量 / `agenthub-server/.env`（前缀即字段名，大小写不敏感）：

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `HOST` | `0.0.0.0` | 进程内 ASGI 监听地址（一般无需改） |
| `PORT` | `8642` | 端口 |
| `DEBUG` | `false` | 调试日志 |
| `AUTO_COMMIT_ON_TASK` | `false` | 写型任务成功后是否自动 `git commit`；默认仅 `git add` 暂存，避免意外推进基线 |
| `AGENTHUB_PYTHON` | — | （客户端）覆盖后端 Python 解释器路径 |

声明式配置：

- **`agenthub-server/config/adapters.yaml`** — 适配器（Claude / Codex / Mock）参数。
- **`agenthub-server/config/mcp.yaml`** — MCP 工具服务器（本地 stdio / 远程 HTTP），可按 Agent 能力白名单下发。
- **`agenthub-server/agents/*.md`** — 角色定义（名称 / 描述 / 结构化能力 / system prompt），首次启动 seed 进数据库。

---

## 🧑‍💻 开发

| 位置 | 命令 | 说明 |
| --- | --- | --- |
| `agenthub` | `npm run dev` | 开发态客户端（热更新） |
| `agenthub` | `npm run typecheck` | TS 类型检查（node + web） |
| `agenthub` | `npm run lint` | ESLint |
| `agenthub` | `npm run format` | Prettier |
| `agenthub-server` | `python -m pytest -q` | 运行测试 |
| `agenthub-server` | `ruff check app/` | Lint（line-length 100） |
| `agenthub-server` | `mypy app/` | 类型检查（strict） |

**提交前**建议跑通：前端 `npm run typecheck && npm run lint`，后端 `python -m pytest -q && ruff check app/`。

---

## 🗺️ 路线图

- [ ] 断线重连的事件重放（当前重连对活动会话做一次全量重拉补帧）
- [ ] Diff 大文件虚拟化渲染
- [ ] Agent 结构化能力（skill specs）的前端可视化编辑表单
- [ ] 审查与 git 面板联动（审批通过 → 可视化暂存 / 提交）
- [ ] 演进为分布式 / 多厂商 Agent 互联（A2A 协议）

---

## 🤝 贡献

欢迎 issue 与 PR。提交前请确保通过上表的 lint / typecheck / 测试，并遵循现有代码风格（后端 ruff line-length 100、mypy strict；前端 ESLint + Prettier）。改动数据契约时记得同步 `agenthub-server/app/schemas.py` 与前端类型。

## 📄 License

[MIT](LICENSE) © AgentHub

## 🙏 致谢

- **[MiMo-Code](https://github.com/XiaomiMiMo/MiMo-Code)** — 多处核心设计的重要参考来源：Markdown 驱动的 Agent 定义、真实 token 计量与上下文压力分级（50% / 70% / 85%）、结构化滚动摘要（compaction）模板、超限文本头尾软修剪（soft prune）、多模态附件契约（FilePart）。
- [Claude Agent SDK](https://docs.anthropic.com/) · [OpenAI Codex SDK](https://openai.com/) — 底层编码 Agent 能力
- [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) — 统一工具接入
- [A2A / Agent2Agent](https://github.com/google/A2A) — 结构化能力描述（Agent Card）思想来源
- [electron-vite](https://electron-vite.org/) · [FastAPI](https://fastapi.tiangolo.com/) · [SQLAlchemy](https://www.sqlalchemy.org/)
