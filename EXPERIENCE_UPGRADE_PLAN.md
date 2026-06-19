# AgentHub 前端体验升级计划

> **面向执行者：** 按 P0 → P1 → P2 顺序逐项实现，每项独立 commit；每项完成后 `npm run typecheck && npm run lint:client` 必须通过，i18n 文案同步补 `zh-CN.ts` 与 `en.ts` 两份。

**目标：** 不重写架构，补齐前端高频便利功能，提升上手与日常使用效率。
**架构：** Electron + React 19 + TypeScript + Zustand + Tailwind/Radix；纯前端增强，复用现有 `store` / `services` / `components/ui`，默认零后端契约变更（涉及后端处单独标注）。
**技术栈：** electron-vite、zustand、cmdk（已封装在 `components/ui/command.tsx`）、sonner、lucide-react；新增依赖仅 `react-virtuoso`（P1 虚拟化用）。

---

## 现状基线（已具备，勿重复造）

i18n / 明暗主题（`services/theme.ts`）/ 会话搜索（ConversationList）/ 代码复制（CodeBlock）/ 图片粘贴·拖拽·预览（MessageInput）/ @提及 / 斜杠命令 / 引用回复 / 上下文计量 / 桌面通知（`services/notify.ts`）/ 可记忆拖拽面板（ResizeHandle + localStorage）/ diff 键盘导航（ReviewCenter）/ `prefers-reduced-motion` 降级。

---

## 阶段总览

| 阶段 | 项 | 主题 | 估时 |
| --- | --- | --- | --- |
| P0 高性价比 | 1–4 | 全局命令面板、输入历史、消息操作、错误重试 | ~2–3 天 |
| P1 体验进阶 | 5–9 | 快捷键速查、长会话虚拟化、会话组织、首次引导、导出 | ~4–6 天 |
| P2 锦上添花 | 10–13 | 提示词模板、/命令增强、拖任意文件、Agent 进度显性 | ~2–3 天 |

---

## P0 · 高性价比（先做）

### 任务 1 — 全局命令面板 Cmd/Ctrl+K
- **文件：** 新增 `components/command/CommandPalette.tsx`；改 `App.tsx`（挂载 + 全局 keydown）；复用 `components/ui/command.tsx`、`store`（会话/agents/activePage）。
- **做法：** 全局监听 `(e.metaKey||e.ctrlKey) && e.key==='k'` 且当前焦点不在 textarea/input 时打开 `CommandDialog`；分组项：跳转会话、切换 Agent 页/管理/设置、打开右栏面板、快捷动作（新建会话）。
- **冲突规避：** ReviewCenter 已用裸 `k`（局部），本面板用 Cmd/Ctrl+K 且全局守卫，互不冲突。
- **验收：** Cmd/Ctrl+K 打开；输入过滤；Enter 跳转；Esc 关闭；输入框聚焦时不抢键。
- **提交：** `feat(ui): 全局命令面板 Cmd/Ctrl+K`

### 任务 2 — 输入框历史回溯（↑/↓）
- **文件：** 改 `components/chat/MessageInput.tsx`、`store`（新增 per-conversation 已发消息历史栈，上限 50）。
- **做法：** `sendMessage` 时把纯文本压入历史；空输入时 ↑ 取上一条、↓ 取下一条填入 textarea（与 @/ 菜单导航互斥：菜单开时 ↑↓ 仍归菜单）。
- **验收：** 空输入连按 ↑ 依次回溯；编辑后可发送；菜单弹出时 ↑↓ 不误触历史。
- **提交：** `feat(chat): 输入框 ↑/↓ 历史回溯`

### 任务 3 — 消息操作：编辑重发 / 重新生成 / 复制整条
- **文件：** 改 `components/chat/MessageBubble.tsx`（悬浮操作条）、`store`、必要时 `services/websocket.ts`（复用现有 `sendMessage` / `stopGeneration`）。
- **做法：** 用户消息：编辑→回填输入框（复用 `draftMessage`）重发；Agent 消息：重新生成（以上一条用户输入重发）；所有消息：复制整条到剪贴板（toast 反馈）。
- **验收：** 三个动作可用；复制有 toast；重发/重生成走既有发送链路、running 态禁用。
- **提交：** `feat(chat): 消息编辑重发/重新生成/复制`

### 任务 4 — 瞬时错误条内联「重试」
- **文件：** 改 `MessageInput.tsx`（transientError 浮条加重试按钮）、`store`（缓存 lastSend 的 content+attachments）。
- **做法：** 发送时缓存最后一次 payload；错误条增「重试」按钮 → 用缓存重发；成功后清缓存。
- **验收：** 触发 SDK 重试错误后，点重试可重发最后一条；不重复进消息流。
- **提交：** `feat(chat): 瞬时错误内联重试`

---

## P1 · 体验进阶（执行前各任务再细化）

### 任务 5 — 快捷键速查表 + 全局键
- 文件：新增 `components/help/ShortcutsSheet.tsx`；`App.tsx` 注册全局键。
- 范围：`?` 打开速查；全局键：聚焦输入、上下切会话、开合右栏、新建会话。验收：按键生效且与输入态不冲突。

### 任务 6 — 长会话虚拟化
- 文件：`components/chat/ChatWindow.tsx`；新增依赖 `react-virtuoso`。
- 范围：消息列表改虚拟滚动，保留自动滚底/锚定/「滚到底」按钮。验收：千条消息流畅；新消息自动贴底；历史不跳动。⚠ 回归重点。

### 任务 7 — 会话组织（置顶/标签/归档/排序）
- 文件：`components/conversation/ConversationList.tsx`、`store`、可能后端持久化字段（标注：需后端加字段或前端 localStorage 先行）。
- 范围：右键菜单置顶/归档/打标签；拖拽排序。验收：状态持久化、刷新保留。

### 任务 8 — 首次引导 + 空状态示例 prompt
- 文件：新增 `components/onboarding/`；ChatWindow 空态。
- 范围：首启动引导卡（localStorage 标记看过）；空会话给 3–5 个可点击示例 prompt。验收：首次出现、可跳过、点击填入输入框。

### 任务 9 — 导出
- 文件：新增 `services/export.ts`；会话头/菜单入口。
- 范围：会话导出 Markdown；diff 导出 `.patch`。验收：导出文件内容正确、含元信息。

---

## P2 · 锦上添花

### 任务 10 — 提示词模板/片段
- 文件：新增 `components/prompts/`、SettingsPage 管理入口、`store`。
- 范围：常用 prompt 增删改 + 输入框一键插入（可接入斜杠菜单）。

### 任务 11 — 斜杠命令在非空输入也可触发
- 文件：`MessageInput.tsx`（放宽 `insertSlash`/`refreshMenu` 的空输入限制，改为行首 `/` 触发）。

### 任务 12 — 拖拽非图片文件 → 项目相对路径引用
- 文件：`MessageInput.tsx`（`addFiles` 对非图片走 `attachFile` 的相对路径逻辑）。

### 任务 13 — Agent 进度显性
- 文件：`components/chat/AgentStatusBar.tsx`、`components/task/TaskPanel.tsx`、`store`。
- 范围：展示当前步骤/已耗时/（可选）ETA。验收：running 态实时更新。

---

## 验证与质量门（每项必过）

- 前端：`npm run typecheck` + `npm run lint:client` 通过；关键交互手动走查。
- i18n：新增文案同时补 `i18n/zh-CN.ts` 与 `i18n/en.ts`，无硬编码中文。
- 动效：尊重 `prefers-reduced-motion`。
- 每项独立 commit；纯 UI 项可豁免后端测试，涉及 store/契约则补充验证。

## 风险与注意

- 全局热键与局部热键（ReviewCenter `k`）冲突 → 全局键统一 Cmd/Ctrl 前缀 + 焦点守卫。
- 虚拟化是最大回归面（滚动锚定/自动滚底）→ 单独 PR、重点回归。
- 会话组织若要跨设备持久化需后端字段；可先 localStorage 落地，再决定是否上后端。

## 落地顺序建议

P0-1 → P0-2 → P0-3 → P0-4（各自独立可见收益）→ 复盘后进入 P1（先 6 虚拟化打底，再 5/7/8/9）→ P2 收尾。
