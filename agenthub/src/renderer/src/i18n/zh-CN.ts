import type { Dict } from './index'

export const zhCN: Dict = {
  common: {
    retry: '重试',
    cancel: '取消',
    save: '保存',
    create: '创建',
    confirm: '确定',
    delete: '删除',
    close: '关闭',
    back: '返回',
    colon: '：',
    copy: '复制',
    copied: '已复制',
    meInitial: '我',
    yesterday: '昨天',
    status: {
      running: '运行中',
      connecting: '连接中',
      disconnected: '未连接',
      online: '在线',
      idle: '空闲',
      error: '错误',
      offline: '离线'
    }
  },
  nav: {
    chat: '会话',
    agents: 'Agent',
    manage: '管理中心',
    settings: '设置'
  },
  connection: {
    disconnected: 'AgentHub 引擎未连接',
    reconnect: '重连'
  },
  titlebar: {
    toLight: '切换为亮色',
    toDark: '切换为暗色'
  },
  diff: {
    unified: '统一',
    split: '对照',
    title: '变更评审',
    pendingTag: '待审批',
    fileCount: '{count} 个文件',
    approve: '批准',
    reject: '拒绝',
    requestRevision: '要求修改',
    approved: '已批准',
    rejected: '已拒绝',
    revisionDraft: '@reviewer 请修改以下文件的变更：{files}\n修改要求：'
  },
  rightDock: {
    review: '审查',
    task: '任务',
    plan: '计划',
    git: 'Git',
    preview: '预览'
  },
  plan: {
    noConversation: '选择一个会话查看其计划',
    empty: '暂无计划（多步 pipeline 任务才会生成）',
    refresh: '刷新',
    save: '保存',
    saved: '已保存',
    saveFailed: '保存失败'
  },
  review: {
    title: '审查队列',
    empty: '暂无待审查项',
    emptySub: 'Agent 产生代码变更或高风险动作时，将在此统一审查',
    pendingCount: '{count} 项待审批',
    selectAll: '全选',
    selectedCount: '已选 {count} 项',
    batchApprove: '批量通过',
    batchReject: '批量拒绝',
    highRiskNotice: '高风险操作，请确认变更内容与影响范围后再决策',
    highRiskConfirmHint: '高风险操作：请用 Shift+A，或点击「确认通过」',
    confirmApprove: '确认通过',
    requestRevision: '要求修改',
    revisionPlaceholder: '说明需要修改的内容（将随拒绝一并发回 Agent）…',
    diffUnavailable: '该变更暂无可视 diff，可在 Git 标签查看工作区差异',
    kbdHint: 'j/k 切换文件 · a 通过 · r 拒绝（高风险需 Shift+A）',
    diff: {
      showTree: '显示文件树',
      hideTree: '隐藏文件树',
      collapseUnchanged: '折叠未变更行',
      changesOnly: '仅看变更',
      searchFiles: '搜索文件…',
      noFile: '选择左侧文件查看变更',
      viewed: '已查看 {done}/{total}',
      markViewed: '标记为已查看',
      wordLevel: '词级',
      lineLevel: '行级',
      compareMethod: '对比粒度'
    }
  },
  explorer: {
    title: '工作区文件',
    empty: '工作区为空',
    truncated: '文件过多，仅显示部分',
    binary: '二进制文件，无法预览',
    tooLarge: '文件过大，无法预览'
  },
  preview: {
    waiting: '等待 Preview 服务启动...',
    refresh: '刷新',
    terminalLogs: '终端日志',
    logs: '日志',
    noLogs: '暂无日志',
    empty: '点击「启动」运行 dev server，或手填地址预览',
    openInBrowser: '在浏览器中打开',
    start: '启动',
    starting: '启动中...',
    stop: '停止',
    startHint: '自动识别 Vite / Flask / Django / 静态站点',
    startFailed: '预览启动失败',
    manualPlaceholder: 'http://localhost:端口',
    go: '前往',
    stopped: '已停止',
    projectType: {
      node: 'Node',
      flask: 'Flask',
      django: 'Django',
      static: '静态',
      python: 'Python'
    }
  },
  task: {
    title: '任务进度',
    empty: '暂无任务',
    retry: '重试',
    retryFailed: '重试失败，请稍后再试',
    dependsOn: '依赖',
    detail: '详情',
    status: {
      pending: '等待',
      running: '运行中',
      waitingApproval: '待审批',
      success: '完成',
      failed: '失败',
      cancelled: '已取消'
    }
  },
  git: {
    files: '文件',
    refresh: '刷新',
    branch: '分支 {name}',
    loadError: '加载失败，请确认 AgentHub 引擎已就绪',
    noWorkspace: '工作区尚未创建',
    noWorkspaceSub: '发送第一条任务消息后，AgentHub 会为本会话创建 workspace',
    notGitRepo: '非 git 工作区',
    rootDir: '根目录',
    clean: '工作区干净',
    cleanSub: '没有未提交的变更',
    noDiff: '暂无差异',
    noDiffSub: '工作区与 HEAD 一致',
    noCommits: '暂无提交记录',
    tab: {
      explorer: '资源',
      changes: '变更',
      log: '提交'
    },
    time: {
      justNow: '刚刚',
      minutesAgo: '{n} 分钟前',
      hoursAgo: '{n} 小时前',
      daysAgo: '{n} 天前'
    }
  },
  approval: {
    ariaLabel: '待确认审批',
    pendingPill: '{count} 项待确认',
    needConfirm: '需要您的确认',
    totalItems: '共 {count} 项',
    agentCountSuffix: ' · {count} 个 Agent',
    collapse: '收起',
    unknownAgent: '未知 Agent',
    questionNav: '第 {current} / {total} 题',
    noSummary: '（无补充说明）',
    reject: '拒绝',
    approve: '批准',
    prev: '上一题',
    next: '下一题',
    submitGroup: '提交 {name} 的 {count} 项决策',
    completeAll: '请先完成全部选择（{decided}/{total}）',
    risk: {
      low: '低风险',
      medium: '中等风险',
      high: '高风险'
    },
    action: {
      apply_diff: '应用代码变更',
      run_command: '执行命令',
      install_dependency: '安装依赖',
      deploy: '部署应用'
    }
  },
  resize: {
    hint: '拖动调整宽度（双击复位）'
  },
  errors: {
    bridgeUnavailable: 'AgentHub bridge 不可用（请在桌面端运行）',
    engineNotReady: 'AgentHub 引擎未就绪，消息未发送，请稍候或重启引擎',
    engineReady: '请确认 AgentHub 引擎已就绪',
    sendFailed: '发送失败（{status}）：{text}',
    sendRetry: '发送失败，请重试',
    retry: '请重试',
    unknown: '未知错误'
  },
  store: {
    loadConvFailed: '加载会话失败',
    sendFailed: '消息发送失败',
    stopFailed: '停止失败，请确认 AgentHub 引擎已就绪',
    rollbackFailed: '回退失败，请确认 AgentHub 引擎已就绪',
    approvalSubmitFailed: '审批提交失败，请确认 AgentHub 引擎已就绪',
    approvalNotifyTitle: '有待审批操作',
    approvalNotifyBody: '{who} 请求{action}：{summary}',
    approvalResolveFailedTitle: '审批未能生效',
    approvalResolveFailedBody:
      '审批已记录，但执行该操作的 Agent 已不在（可能服务重启或审批超时）。请在任务面板重试该任务。',
    taskDone: '任务完成',
    agentError: 'Agent 执行出错',
    loadAgentsFailed: '加载 Agent 列表失败',
    loadConvListFailed: '加载会话列表失败',
    engineError: 'AgentHub 引擎异常'
  },
  chat: {
    memberStackTitle: '群成员 {count} 人，点击管理',
    yesterday: '昨天 {time}',
    loading: '加载中…',
    loadOlder: '加载更早的消息',
    empty: {
      title: '多 Agent 协作工作台',
      subtitle: '选择或新建一个会话，让 AI 团队为你工作',
      newProjectTitle: '新建项目会话',
      newProjectDesc: '关联本地项目，组建 Agent 群',
      mentionTitle: '@Agent 直达',
      mentionDesc: '@coder 改这里、@reviewer 审查',
      slashTitle: '/ 快捷命令',
      slashDesc: '/plan 出计划、/tasks 看进度'
    },
    toolbar: {
      group: '群设置',
      taskTitle: '任务面板',
      task: '任务',
      planTitle: '计划文档（需求 / 设计 / 任务三件套）',
      plan: '计划',
      filesTitle: '工作区文件变更与提交历史',
      files: '文件',
      diffTitle: 'Diff 查看',
      review: '审查',
      reviewTitle: '审查变更与审批',
      preview: '预览'
    },
    input: {
      user: '用户',
      placeholder: '输入消息，@ 呼叫 Agent，/ 使用命令...',
      placeholderRunning: 'Agent 正在执行任务，完成后可继续发送…',
      reply: '回复',
      cancelQuote: '取消引用 (Esc)',
      atTitle: '@ 呼叫 Agent',
      slashTitle: '/ 命令',
      codeTitle: '插入代码块',
      fileTitle: '引用文件',
      imageTitle: '发送图片',
      removeAttachment: '移除',
      transientError: '模型连接异常，重试中',
      working: 'Agent 工作中…',
      enterHint: 'Enter 发送 / Shift+Enter 换行',
      contextTitle: '上下文已用 {used} / {window} tokens',
      context: '上下文',
      stop: '停止本轮执行',
      send: '发送',
      roleDesc: {
        orchestrator: '需求拆解与任务编排',
        planner: '分析项目结构与计划',
        coder: '代码修改与实现',
        reviewer: '代码审查',
        preview: '启动网页预览',
        deployer: '确认并部署'
      },
      cmd: {
        plan: '让 Planner 制定计划',
        review: '发起代码审查',
        deploy: '发起部署流程',
        tasks: '打开任务面板',
        files: '查看文件变更与提交历史',
        diff: '查看代码 Diff',
        preview: '打开网页预览',
        group: '群设置（成员 / 规则 / 技能）'
      }
    },
    tools: {
      using: '正在使用工具（{cur}/{total}）',
      used: '使用了 {count} 个工具',
      failed: '失败',
      done: '完成',
      statusRunning: '执行中',
      statusDone: '完成',
      statusFailed: '失败'
    },
    thinking: {
      thinking: '正在思考…',
      thoughtFor: '已思考 {duration}',
      thought: '已思考'
    },
    bubble: {
      quote: '引用回复',
      rollback: '回退到此处',
      rollbackConfirm: '再次点击确认：删除本条及之后的全部消息',
      rollbackConfirmShort: '确认回退'
    },
    code: {
      copyCode: '复制代码'
    },
    statusBar: {
      doing: '正在：{title}',
      working: '工作中…',
      scheduling: '调度中…'
    }
  },
  conv: {
    title: '会话',
    newProject: '新建项目',
    search: '搜索会话',
    pin: '置顶会话',
    unpin: '取消置顶',
    archive: '归档会话',
    archiveConfirm: '再次点击确认归档',
    delete: '删除会话',
    deleteConfirm: '再次点击永久删除',
    group: {
      title: '群设置',
      members: '群成员（{count}）',
      allMembers: '全员',
      invite: '邀请',
      inviteAgent: '邀请 Agent',
      inviteHeading: '邀请 Agent 入群',
      inviteEmpty: '所有已启用的 Agent 均已在群中',
      owner: '群主（不可移除）',
      remove: '移除 {name}',
      mcp: 'MCP 服务',
      mcpEmpty: '仓库暂无 MCP，前往管理中心添加',
      skills: '技能',
      skillsEmpty: '仓库暂无技能，前往管理中心添加',
      rules: '规则',
      rulesEmpty: '仓库暂无规则，前往管理中心添加',
      extraRules: '附加规则（可选）',
      extraRulesPlaceholder: '仅本会话生效的临时补充，例如：\n本项目用 pnpm；禁止修改 CI 配置',
      intensity: '协作强度',
      saved: '已保存',
      save: '保存群设置',
      saveError: '保存失败，请确认 AgentHub 引擎已就绪',
      unnamedMcp: '未命名服务',
      unnamedSkill: '未命名技能',
      unnamedRule: '未命名规则',
      mcpKind: { local: '本地进程', remote: '远程服务' },
      ruleKind: { instruction: '指令文件', permission: '工具权限' },
      intensity_lite: '精简',
      intensity_liteDesc: '尽量直接回答或单步完成，少拆任务',
      intensity_standard: '标准',
      intensity_standardDesc: '由编排器按需判断协作深度',
      intensity_strict: '严格',
      intensity_strictDesc: '复杂任务自动加审查收尾'
    },
    newProjectModal: {
      invite: '邀请群成员',
      selected: '已选 {sel}/{total}（全选 = 全员，新 Agent 自动入群）',
      pickDirError: '选择目录失败',
      createError: '创建项目失败，请确认后端服务已启动',
      titleChoose: '新建项目',
      titleBlank: '新建空白项目',
      titleFolder: '打开项目文件夹',
      useExisting: '使用现有文件夹',
      useExistingDesc: '选择本地已有的项目目录',
      blank: '新建空白项目',
      blankDesc: '从零开始创建一个新项目',
      create: '创建项目',
      projectName: '项目名称',
      projectNamePlaceholder: '输入项目名称'
    }
  },
  agents: {
    page: {
      title: 'Agent 管理',
      subtitle: '查看和配置协作 Agent，支持自定义角色、技能与分组',
      add: '添加 Agent',
      loadErrorTitle: '无法加载 Agent 列表',
      loadErrorDesc: '请确认 AgentHub 引擎已就绪',
      retry: '重试',
      loading: '正在加载 Agent…',
      emptyTitle: '还没有 Agent',
      emptyDesc: '点击右上角「添加 Agent」创建第一个协作 Agent',
      enabled: '已启用',
      disabled: '未启用',
      customRole: '自定义角色：{role}',
      independentProvider: '独立供应商',
      config: '配置',
      enable: '启用',
      disable: '停用'
    },
    form: {
      name: '名称',
      namePlaceholder: 'Agent 名称',
      role: '角色标识',
      rolePlaceholder: '如 coder、tester、doc-writer（自定义）',
      desc: '描述',
      descPlaceholder: '该 Agent 的职责说明，将注入其 system prompt',
      skills: '技能',
      skillsPlaceholder: '逗号分隔，如 React, 单元测试, SQL 优化',
      group: '分组标签',
      groupPlaceholder: '如 core、前端组',
      adapter: '适配器类型',
      model: '模型',
      modelPlaceholder: '留空使用 SDK 默认模型',
      provider: 'API 供应商（可选）',
      providerHint: '留空走本地 {adapter} 登录态；填写后仅该 Agent 使用此供应商，互不影响',
      baseUrlPlaceholderCodex: '如 https://api.deepseek.com/v1',
      baseUrlPlaceholderClaude: '如 https://api.moonshot.cn/anthropic'
    },
    modal: {
      configTitle: '配置 {name}',
      addTitle: '添加 Agent',
      orchestratorLocked: 'orchestrator 为系统固定角色，不可新增'
    },
    notify: {
      saveFailed: '保存 Agent 失败',
      createFailed: '创建 Agent 失败',
      loadFailed: '加载 Agent 列表失败',
      enableFailed: '启用 Agent 失败',
      disableFailed: '停用 Agent 失败',
      retryLater: '请稍后重试',
      engineReady: '请确认 AgentHub 引擎已就绪'
    },
    roleDesc: {
      orchestrator: '编排中心，自动拆解需求并调度其他 Agent 协作完成任务。',
      planner: '分析项目结构，制定实现计划，输出详细的技术计划。',
      coder: '根据计划执行代码修改、新增功能、修复 Bug，输出可执行的 Diff。',
      reviewer: '对 Coder 输出的代码进行审查，发现潜在问题并提出改进建议。',
      deployer: '将代码构建并部署到目标环境，需用户审批后执行。'
    }
  },
  manage: {
    page: {
      title: '管理中心',
      subtitle: '统一管理 MCP 服务、技能库与规则库',
      tabSkills: '技能库',
      tabRules: '规则'
    },
    status: {
      pending: '连接中',
      connected: '已连接',
      failed: '失败',
      disabled: '已禁用',
      needs_auth: '需授权',
      needs_client_registration: '需注册'
    },
    mcpKind: { local: '本地进程', remote: '远程服务' },
    ruleKind: { instruction: '指令文件', permission: '工具权限' },
    actionLabel: { allow: '允许', ask: '询问', deny: '拒绝' },
    detail: { namePlaceholder: '名称', enabled: '已启用', disabled: '已停用', delete: '删除' },
    mcp: {
      searchPlaceholder: '搜索 MCP 服务',
      createLabel: '新建 MCP 服务',
      summary: '已启用 {enabled}/{total}',
      empty: '暂无 MCP 服务',
      unnamed: '未命名服务',
      emptyDetail: '从左侧选择一个 MCP 服务，或点击 + 新建',
      newName: '新 MCP 服务'
    },
    skills: {
      searchPlaceholder: '搜索技能',
      createLabel: '新建技能',
      summary: '共 {count} 个技能',
      empty: '暂无技能',
      unnamed: '未命名技能',
      defaultCategory: '技能',
      fileCount: '{count} 个文件',
      emptyDetail: '从左侧选择一个技能，或点击 + 新建'
    },
    rules: {
      searchPlaceholder: '搜索规则',
      createLabel: '新建规则',
      summary: '共 {count} 条规则',
      empty: '暂无规则',
      unnamed: '未命名规则',
      noDesc: '无描述',
      emptyDetail: '从左侧选择一条规则，或点击 + 新建',
      newName: '新规则'
    },
    picker: {
      all: '全部 {total}',
      selectAll: '全选',
      clear: '清空',
      manage: '管理',
      manageTitle: '在悬浮面板中管理',
      searchPrefix: '搜索{title}',
      noMatch: '无匹配项'
    },
    mcpEditor: {
      autoCheck: '自动检测',
      recheck: '重新检测',
      connection: '连接方式',
      command: '启动命令',
      commandHint: '每行一个 token，首行为可执行文件',
      env: '环境变量',
      envHint: 'KEY=VALUE，每行一个',
      url: '服务地址',
      headers: '请求头',
      oauth: 'OAuth 鉴权',
      oauthHint: '远程服务需要授权时开启（支持动态注册）',
      on: '启用',
      off: '关闭',
      timeout: '超时(ms)',
      timeoutHint: '留空使用默认 5000',
      desc: '描述',
      descPlaceholder: '一句话说明该服务能力'
    },
    mcpRepo: {
      parseError: 'JSON 解析失败，请检查格式',
      applied: '已应用：共 {count} 个服务（状态将自动重测）',
      reverted: '已还原为当前仓库内容',
      back: '返回列表',
      heading: '整库 MCP · opencode mcp 格式',
      revert: '还原',
      apply: '应用整库'
    },
    skillOrigin: { manual: '手动创建', local: '本地文件夹', remote: '远程 URL' },
    skillEditor: {
      descLabel: '描述',
      descHint: '对应 SKILL.md 的 frontmatter description',
      descPlaceholder: '一句话说明该技能的用途与触发场景',
      category: '分类',
      categoryPlaceholder: '如：研发 / 测试 / 文档',
      folder: '技能文件夹',
      newFile: '新建文件',
      locked: '锁定',
      skillMdNoRename: 'SKILL.md 不可重命名',
      pathHint: '输入含 “/” 的路径可移动到子目录，如 scripts/run.sh',
      skillMdNoDelete: 'SKILL.md 不可删除',
      deleteFile: '删除文件',
      skillMdPlaceholder:
        '---\nname: 技能名\ndescription: 简述\n---\n\n在此编写技能说明、步骤与示例…',
      filePlaceholder: '文件内容（脚本 / 参考 / 资源）…',
      pickFile: '从左侧选择一个文件进行编辑'
    },
    addSkill: {
      title: '添加技能',
      blank: '新建空技能',
      blankSub: '仅含 SKILL.md',
      fromLocal: '从本地文件夹导入',
      fromLocalSub: '如 ~/.agents/skills/foo',
      fromUrl: '从 URL 导入',
      fromUrlSub: '远程技能索引地址',
      localPath: '本地文件夹路径',
      remoteUrl: '远程技能 URL',
      back: '返回',
      import: '导入'
    },
    ruleEditor: {
      type: '规则类型',
      desc: '描述',
      descPlaceholder: '一句话说明该规则',
      content: '指令内容',
      contentHint: 'markdown，注入会话指令（类 AGENTS.md）',
      contentPlaceholder: '例如：所有提交必须附带测试；优先从用户视角解释 WHY…',
      permsTitle: '工具权限 · 每项可设 允许 / 询问 / 拒绝'
    },
    data: {
      cmdEmpty: '启动命令为空',
      urlInvalid: '服务地址无效',
      newSkill: '新技能',
      importSkill: '导入技能',
      importRule: '导入规则',
      seedMcpDesc: '本地文件系统读写能力（示例）',
      seedSkillName: '代码审查',
      seedSkillCategory: '研发',
      seedSkillDesc: '系统化的代码审查清单与要点',
      seedSkillContent:
        '---\nname: 代码审查\ndescription: 系统化的代码审查清单与要点\n---\n\n审查时关注：正确性、边界条件、错误处理、命名与可读性、测试覆盖与安全性。',
      seedRuleStyleName: '中文输出',
      seedRuleStyleDesc: '统一回复语言',
      seedRuleStyleContent: '除代码与专有名词外，一律使用简体中文回复。',
      seedRulePermName: '谨慎执行',
      seedRulePermDesc: '危险操作需确认'
    },
    groupModal: {
      title: '群聊资源管理',
      subtitle: '{name} · 勾选项即本群启用，未勾选 = 不加载',
      tabSkills: '技能',
      tabRules: '规则',
      typeMcp: 'MCP 服务',
      typeSkill: '技能',
      typeRule: '规则',
      searchPrefix: '搜索{type}',
      createPrefix: '新建{type}',
      import: '导入',
      importNotFound: '未解析到有效数据，请检查 JSON 格式',
      importSuccess: '成功导入 {count} 项',
      confirmImport: '确认导入',
      enableInGroupPrefix: '本群启用',
      enableAll: '全部 {total}',
      selectAll: '全选',
      clear: '清空',
      emptyNew: '暂无{type}，点 + 新建或导入',
      noMatch: '无匹配项',
      disabledInRepo: '已在库中禁用，不可启用',
      enabledInGroup: '本群已启用',
      notEnabledInGroup: '本群未启用',
      unnamed: '未命名{type}',
      disabledBadge: '已禁用',
      deleteFromRepo: '从仓库删除',
      enabledLabel: '已启用',
      disabledLabel: '已禁用',
      pickItem: '从左侧选择一项进行编辑，或新建 / 导入',
      footerSummary: '本群启用：MCP {mcp} · 技能 {skills} · 规则 {rules}',
      editMcpJson: '编辑整库 MCP JSON',
      checkAllMcp: '检查全部 MCP 在线状态',
      saveError: '保存失败，请确认 AgentHub 引擎已就绪',
      mcpImportPlaceholder:
        '粘贴标准 mcpServers JSON，例如：\n{\n  "mcpServers": {\n    "filesystem": {\n      "command": "npx",\n      "args": ["-y", "@modelcontextprotocol/server-filesystem", "."]\n    }\n  }\n}',
      skillImportPlaceholder:
        '粘贴技能 JSON（单个或数组）：{"name":"代码审查","description":"...","files":[{"path":"SKILL.md","content":"..."}]}',
      ruleImportPlaceholder:
        '粘贴规则 JSON（单个或数组）：{"name":"中文输出","kind":"instruction","content":"..."} 或 {"name":"谨慎执行","kind":"permission","permissions":{"bash":"ask"}}'
    }
  },
  settings: {
    title: '设置',
    sections: {
      engine: '引擎',
      engineDesc: '查看后端引擎状态并重启',
      notify: '通知',
      notifyDesc: '任务完成、审批提醒等通知设置',
      theme: '外观',
      themeDesc: '主题颜色、字体大小、语言'
    },
    engine: {
      heading: '后端引擎',
      statusLine: 'AgentHub 引擎：{status}',
      hint: '后端作为主进程内置子进程随应用启动，无需手动配置地址',
      restart: '重启引擎'
    },
    notify: {
      heading: '通知设置',
      taskDone: '任务完成通知',
      taskDoneDesc: '当 Agent 任务执行完成时通知',
      approval: '审批提醒',
      approvalDesc: '有待审批操作时弹出提醒',
      error: '错误告警',
      errorDesc: 'Agent 执行出错时通知'
    },
    theme: {
      heading: '外观设置',
      theme: '主题',
      light: '浅色',
      dark: '深色',
      system: '跟随系统',
      language: '语言',
      fontSize: '字体大小',
      fontSmall: '小（12px）',
      fontDefault: '默认（14px）',
      fontLarge: '大（16px）'
    }
  }
}
