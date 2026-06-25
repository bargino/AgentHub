import type { Dict } from './index'

export const en: Dict = {
  common: {
    retry: 'Retry',
    cancel: 'Cancel',
    save: 'Save',
    create: 'Create',
    confirm: 'Confirm',
    delete: 'Delete',
    edit: 'Edit',
    close: 'Close',
    back: 'Back',
    colon: ': ',
    copy: 'Copy',
    copied: 'Copied',
    meInitial: 'Me',
    yesterday: 'Yesterday',
    status: {
      running: 'Running',
      connecting: 'Connecting',
      disconnected: 'Disconnected',
      online: 'Online',
      idle: 'Idle',
      error: 'Error',
      offline: 'Offline'
    }
  },
  nav: {
    chat: 'Sessions',
    tasks: 'Tasks',
    diff: 'Diff',
    preview: 'Preview',
    deploy: 'Deploy',
    agents: 'Agents',
    providers: 'Providers',
    manage: 'Management',
    settings: 'Settings'
  },
  providers: {
    page: {
      title: 'Provider Configuration',
      subtitle: 'Manage named provider profiles for Claude Code / Codex (à la cc-switch), referenced by agents',
      add: 'New profile',
      loading: 'Loading provider profiles…',
      loadErrorTitle: 'Failed to load',
      loadErrorDesc: 'Could not fetch provider profiles; ensure the engine is ready and retry',
      retry: 'Retry',
      emptyTitle: 'No profiles',
      emptyDesc: 'Click "New profile", or duplicate a built-in preset to start'
    },
    form: {
      preset: 'From preset',
      presetHint: 'Pick a provider template to prefill (migrated from cc-switch), then enter your API Key',
      presetSelect: 'Select a preset template…',
      presetSearch: 'Search presets…',
      presetNoResult: 'No matching presets',
      name: 'Profile name',
      namePlaceholder: 'e.g. DeepSeek-Prod, GLM-Personal',
      baseUrlHint: 'Leave blank to use the local login of this tool',
      model: 'Model',
      modelPlaceholder: 'Leave blank to use the SDK default model',
      wireApi: 'Wire API',
      wireApiHint: 'Third-party usually chat; official/compatible use responses',
      reasoning: 'Reasoning effort',
      reasoningHint: 'codex model_reasoning_effort',
      reasoningDefault: 'Default',
      getApiKey: 'Get API Key',
      fetchModels: 'Fetch models',
      fetching: 'Fetching…',
      speedTest: 'Speed test',
      testing: 'Testing…',
      unreachable: 'Unreachable'
    },
    category: {
      official: 'Official',
      cn_official: 'Domestic',
      aggregator: 'Aggregator',
      custom: 'Custom'
    },
    modal: {
      addTitle: 'New {tool} provider profile',
      editTitle: 'Edit {tool} provider profile'
    },
    card: {
      preset: 'Preset',
      localLogin: 'Local login',
      none: 'Not set',
      duplicate: 'Duplicate',
      copySuffix: 'copy',
      confirmDelete: 'Confirm delete'
    },
    notify: {
      saveFailed: 'Save failed',
      loadFailed: 'Load failed',
      deleteFailed: 'Delete failed',
      retry: 'Please retry later',
      needBaseUrl: 'Please fill in Base URL first',
      modelsFetched: 'Fetched {count} models',
      fetchModelsFailed: 'Failed to fetch models',
      speedTestFailed: 'Speed test failed'
    }
  },
  header: {
    invite: 'Invite members',
    notifications: 'Notifications',
    more: 'More'
  },
  section: {
    taskBoard: 'Task Board / DAG',
    logs: 'Logs',
    artifacts: 'Artifacts',
    metrics: 'Metrics',
    config: 'Config',
    deployStart: 'Start deploy',
    deployApprove: 'Approve deploy',
    deployReject: 'Reject',
    moreActions: 'More actions',
    eventLog: 'Event log',
    viewAll: 'View all',
    deployPlan: 'Release plan',
    viewTopology: 'View topology',
    deployHistory: 'Deploy history',
    deployLog: 'Deploy log',
    envInfo: 'Environment',
    deployConfig: 'Deploy config',
    recentBuild: 'Recent build',
    quickOps: 'Quick actions',
    notifySub: 'Notifications',
    notifyOnChange: 'Notify me on deploy status change',
    devServer: 'Dev server',
    previewEnv: 'Preview environment',
    openExternal: 'Open in new window',
    restart: 'Restart'
  },
  tab: {
    overview: 'Overview',
    chat: 'Chat',
    tasks: 'Tasks',
    diff: 'Diff',
    preview: 'Preview',
    deploy: 'Deploy'
  },
  deploy: {
    noConversation: 'Select a conversation first',
    empty: 'No deployment yet',
    emptyHint: 'Create a deployment plan for this conversation; it runs after approval',
    noSteps: 'This plan has no steps',
    target: 'Target',
    project: 'Project',
    rollback: 'Rollback',
    result: 'Result',
    openResult: 'Open URL',
    statusLabel: 'Status',
    stepCount: 'Steps',
    logPending: 'Logs start once approved and running',
    logEmpty: 'No logs',
    providerLabel: 'Target',
    providerMock: 'Mock (demo)',
    providerDocker: 'Local Docker',
    providerRemote: 'Remote server',
    providerHint: 'Remote needs host + command; Docker can set a port',
    cfgPort: 'Port',
    cfgHost: 'Host',
    cfgUser: 'User',
    cfgCommand: 'Deploy command',
    status: {
      planned: 'Pending approval',
      deploying: 'Deploying',
      success: 'Success',
      failed: 'Failed',
      rejected: 'Rejected'
    }
  },
  overview: {
    welcomeBack: 'Welcome back',
    resume: 'Continue the multi-agent collaboration in this session',
    stat: {
      agents: 'Agents',
      running: 'Running tasks',
      pending: 'Pending approvals',
      done: 'Completed'
    },
    recent: 'Recent activity',
    recentEmpty: 'No activity yet',
    info: 'Session info',
    infoProject: 'Project',
    infoBranch: 'Branch',
    infoStatus: 'Status',
    infoMembers: 'Members',
    tasksUnit: ' tasks',
    membersUnit: ' members'
  },
  palette: {
    title: 'Command Palette',
    desc: 'Search and jump to sessions, pages, panels, or run actions',
    placeholder: 'Search: sessions / pages / panels / actions…',
    empty: 'No results',
    newProject: 'New project',
    group: {
      actions: 'Actions',
      pages: 'Pages',
      panels: 'Panels',
      conversations: 'Sessions'
    },
    panel: {
      review: 'Review (Diff / Approval)',
      task: 'Tasks',
      git: 'Files / Git',
      preview: 'Preview',
      group: 'Group settings'
    }
  },
  connection: {
    disconnected: 'AgentHub engine disconnected',
    reconnect: 'Reconnect'
  },
  titlebar: {
    toLight: 'Switch to light',
    toDark: 'Switch to dark'
  },
  diff: {
    unified: 'Unified',
    split: 'Split',
    title: 'Change review',
    pendingTag: 'Pending',
    fileCount: '{count} files',
    approve: 'Approve',
    reject: 'Reject',
    requestRevision: 'Request changes',
    approved: 'Approved',
    rejected: 'Rejected',
    revisionDraft:
      '@reviewer please revise the changes in these files: {files}\nRequested changes: '
  },
  rightDock: {
    review: 'Review',
    task: 'Tasks',
    spec: 'Specs',
    git: 'Git',
    preview: 'Preview'
  },
  spec: {
    noConversation: 'Pick a session to view its specs',
    empty: 'No specs yet (generated for multi-step pipelines)',
    refresh: 'Refresh',
    save: 'Save',
    saved: 'Saved',
    saveFailed: 'Save failed',
    preview: 'Preview',
    edit: 'Edit'
  },
  review: {
    title: 'Review queue',
    empty: 'Nothing to review',
    emptySub: 'Code changes and high-risk actions from agents show up here for review',
    pendingCount: '{count} pending',
    selectAll: 'Select all',
    selectedCount: '{count} selected',
    batchApprove: 'Approve selected',
    batchReject: 'Reject selected',
    highRiskNotice: 'High-risk action — review the change and its impact before deciding',
    highRiskConfirmHint: 'High-risk action: use Shift+A, or click “Confirm approve”',
    confirmApprove: 'Confirm approve',
    requestRevision: 'Request changes',
    revisionPlaceholder: 'Describe the changes needed (sent back to the agent with the rejection)…',
    diffUnavailable: 'No visual diff for this change; check workspace diff in the Git tab',
    kbdHint: 'j/k switch file · a approve · r reject (Shift+A for high-risk)',
    diff: {
      showTree: 'Show file tree',
      hideTree: 'Hide file tree',
      collapseUnchanged: 'Collapse unchanged lines',
      changesOnly: 'Changes only',
      searchFiles: 'Search files…',
      noFile: 'Select a file to view changes',
      viewed: 'Viewed {done}/{total}',
      markViewed: 'Mark as viewed',
      wordLevel: 'Word',
      lineLevel: 'Line',
      compareMethod: 'Compare by'
    }
  },
  explorer: {
    title: 'Workspace files',
    empty: 'Workspace is empty',
    truncated: 'Too many files, showing a subset',
    binary: 'Binary file, cannot preview',
    tooLarge: 'File too large to preview'
  },
  preview: {
    waiting: 'Waiting for the Preview server to start...',
    refresh: 'Refresh',
    terminalLogs: 'Terminal logs',
    logs: 'Logs',
    noLogs: 'No logs yet',
    empty: 'Click Start to run the dev server, or enter a URL to preview',
    openInBrowser: 'Open in browser',
    start: 'Start',
    starting: 'Starting...',
    stop: 'Stop',
    startHint: 'Auto-detects Vite / Flask / Django / static sites',
    startFailed: 'Failed to start preview',
    manualPlaceholder: 'http://localhost:port',
    go: 'Go',
    stopped: 'Stopped',
    projectType: {
      node: 'Node',
      flask: 'Flask',
      django: 'Django',
      static: 'Static',
      python: 'Python'
    }
  },
  task: {
    title: 'Task progress',
    empty: 'No tasks yet',
    retry: 'Retry',
    retryFailed: 'Retry failed, please try again later',
    dependsOn: 'Depends on',
    detail: 'Details',
    viewList: 'List',
    viewGraph: 'DAG',
    status: {
      pending: 'Pending',
      running: 'Running',
      waitingApproval: 'Awaiting approval',
      success: 'Done',
      failed: 'Failed',
      cancelled: 'Cancelled'
    }
  },
  git: {
    files: 'Files',
    refresh: 'Refresh',
    branch: 'Branch {name}',
    loadError: 'Failed to load — make sure the AgentHub engine is ready',
    noWorkspace: 'Workspace not created yet',
    noWorkspaceSub:
      'After you send the first task message, AgentHub creates a workspace for this session',
    notGitRepo: 'Not a git workspace',
    rootDir: 'Root',
    clean: 'Workspace clean',
    cleanSub: 'No uncommitted changes',
    noDiff: 'No diff',
    noDiffSub: 'Workspace matches HEAD',
    noCommits: 'No commit history',
    tab: {
      explorer: 'Explorer',
      changes: 'Changes',
      log: 'Commits'
    },
    time: {
      justNow: 'just now',
      minutesAgo: '{n} min ago',
      hoursAgo: '{n} h ago',
      daysAgo: '{n} d ago'
    }
  },
  approval: {
    ariaLabel: 'Pending approvals',
    pendingPill: '{count} pending',
    needConfirm: 'Your confirmation needed',
    totalItems: '{count} total',
    agentCountSuffix: ' · {count} agents',
    collapse: 'Collapse',
    unknownAgent: 'Unknown agent',
    questionNav: '{current} / {total}',
    noSummary: '(no additional details)',
    reject: 'Reject',
    approve: 'Approve',
    prev: 'Previous',
    next: 'Next',
    submitGroup: 'Submit {count} decisions for {name}',
    completeAll: 'Complete all choices first ({decided}/{total})',
    risk: {
      low: 'Low risk',
      medium: 'Medium risk',
      high: 'High risk'
    },
    action: {
      apply_diff: 'Apply code changes',
      run_command: 'Run command',
      install_dependency: 'Install dependency',
      deploy: 'Deploy app'
    }
  },
  resize: {
    hint: 'Drag to resize (double-click to reset)'
  },
  errors: {
    bridgeUnavailable: 'AgentHub bridge unavailable (run in the desktop app)',
    engineNotReady:
      'AgentHub engine not ready — message not sent, please wait or restart the engine',
    engineReady: 'Make sure the AgentHub engine is ready',
    sendFailed: 'Send failed ({status}): {text}',
    sendRetry: 'Send failed, please retry',
    retry: 'Please retry',
    unknown: 'Unknown error'
  },
  store: {
    loadConvFailed: 'Failed to load conversation',
    sendFailed: 'Failed to send message',
    stopFailed: 'Failed to stop — make sure the AgentHub engine is ready',
    rollbackFailed: 'Rollback failed — make sure the AgentHub engine is ready',
    approvalSubmitFailed: 'Failed to submit approval — make sure the AgentHub engine is ready',
    approvalNotifyTitle: 'Approval needed',
    approvalNotifyBody: '{who} requests {action}: {summary}',
    approvalResolveFailedTitle: 'Approval could not take effect',
    approvalResolveFailedBody:
      'The approval was recorded, but the agent that would run this action is no longer active (the service may have restarted or the approval timed out). Please retry the task from the task panel.',
    taskDone: 'Task complete',
    agentError: 'Agent execution error',
    loadAgentsFailed: 'Failed to load agent list',
    loadConvListFailed: 'Failed to load conversation list',
    engineError: 'AgentHub engine error',
    deployFailed: 'Deployment request failed',
    deployDone: 'Deployment complete'
  },
  chat: {
    memberStackTitle: '{count} group members · click to manage',
    yesterday: 'Yesterday {time}',
    loading: 'Loading…',
    loadOlder: 'Load earlier messages',
    empty: {
      title: 'Multi-agent workspace',
      subtitle: 'Pick or start a session and let the AI team work for you',
      startTitle: 'Start the collaboration',
      startSubtitle: 'Send the first message, or @ an agent and use / for commands',
      newProjectTitle: 'New project session',
      newProjectDesc: 'Link a local project and assemble an agent group',
      mentionTitle: '@Agent direct',
      mentionDesc: '@coder fix this, @reviewer review',
      slashTitle: '/ Quick commands',
      slashDesc: '/spec to draft, /tasks to track'
    },
    toolbar: {
      group: 'Group settings',
      taskTitle: 'Task panel',
      task: 'Tasks',
      specTitle: 'Spec docs (requirements / design / tasks)',
      spec: 'Specs',
      filesTitle: 'Workspace file changes & commit history',
      files: 'Files',
      diffTitle: 'View diff',
      review: 'Review',
      reviewTitle: 'Review changes & approvals',
      preview: 'Preview'
    },
    input: {
      user: 'User',
      placeholder: 'Type a message, @ to call an agent, / for commands...',
      placeholderRunning: 'Agent is working — you can keep sending once it finishes…',
      reply: 'Reply to',
      cancelQuote: 'Cancel quote (Esc)',
      atTitle: '@ Call an agent',
      slashTitle: '/ Command',
      codeTitle: 'Insert code block',
      fileTitle: 'Attach file',
      imageTitle: 'Attach image',
      removeAttachment: 'Remove',
      transientError: 'Model connection issue, retrying',
      retry: 'Retry',
      working: 'Agent working…',
      enterHint: 'Enter to send / Shift+Enter for newline',
      contextTitle: 'Context used {used} / {window} tokens',
      context: 'Context',
      stop: 'Stop this run',
      send: 'Send',
      roleDesc: {
        orchestrator: 'Requirement breakdown & task orchestration',
        planner: 'Analyze project structure & plan',
        coder: 'Code changes & implementation',
        reviewer: 'Code review',
        preview: 'Start web preview',
        deployer: 'Confirm & deploy'
      },
      cmd: {
        plan: 'Have the Planner draft a plan',
        review: 'Start a code review',
        deploy: 'Start the deploy flow',
        tasks: 'Open the task panel',
        files: 'View file changes & commit history',
        diff: 'View code diff',
        preview: 'Open web preview',
        group: 'Group settings (members / rules / skills)'
      }
    },
    tools: {
      using: 'Using tools ({cur}/{total})',
      used: 'Used {count} tools',
      failed: 'failed',
      done: 'Done',
      statusRunning: 'Running',
      statusDone: 'Done',
      statusFailed: 'Failed'
    },
    thinking: {
      thinking: 'Thinking…',
      thoughtFor: 'Thought for {duration}',
      thought: 'Thought'
    },
    turn: {
      trace: 'Process',
      running: 'Running'
    },
    changes: {
      title: 'Code changes',
      files: '{count} files'
    },
    bubble: {
      quote: 'Quote reply',
      edit: 'Edit & resend',
      regenerate: 'Regenerate',
      rollback: 'Roll back to here',
      rollbackConfirm: 'Click again to confirm: delete this and all later messages',
      rollbackConfirmShort: 'Confirm rollback'
    },
    code: {
      copyCode: 'Copy code'
    },
    statusBar: {
      doing: 'Working on: {title}',
      working: 'Working…',
      scheduling: 'Scheduling…'
    }
  },
  conv: {
    title: 'Sessions',
    newProject: 'New project',
    search: 'Search sessions',
    filter: {
      label: 'Filter sessions',
      all: 'All sessions',
      running: 'Running',
      waitingApproval: 'Awaiting approval',
      pinned: 'Pinned',
      unread: 'Unread',
      archived: 'Archived',
      empty: 'No sessions match this filter'
    },
    pin: 'Pin session',
    unpin: 'Unpin',
    archive: 'Archive session',
    archiveConfirm: 'Click again to confirm archive',
    delete: 'Delete session',
    deleteConfirm: 'Click again to delete permanently',
    group: {
      title: 'Group settings',
      members: 'Members ({count})',
      allMembers: 'All',
      invite: 'Invite',
      inviteAgent: 'Invite agent',
      inviteHeading: 'Invite an agent to the group',
      inviteEmpty: 'All enabled agents are already in the group',
      owner: 'Owner (cannot be removed)',
      remove: 'Remove {name}',
      mcp: 'MCP servers',
      mcpEmpty: 'No MCP in the library yet — add one in Management',
      skills: 'Skills',
      skillsEmpty: 'No skills in the library yet — add one in Management',
      rules: 'Rules',
      rulesEmpty: 'No rules in the library yet — add one in Management',
      extraRules: 'Extra rules (optional)',
      extraRulesPlaceholder:
        'Temporary additions for this session only, e.g.:\nUse pnpm for this project; do not modify CI config',
      intensity: 'Collaboration intensity',
      saved: 'Saved',
      save: 'Save group settings',
      saveError: 'Save failed — make sure the AgentHub engine is ready',
      unnamedMcp: 'Unnamed server',
      unnamedSkill: 'Unnamed skill',
      unnamedRule: 'Unnamed rule',
      mcpKind: { local: 'Local process', remote: 'Remote service' },
      ruleKind: { instruction: 'Instruction file', permission: 'Tool permission' },
      intensity_lite: 'Lite',
      intensity_liteDesc: 'Answer directly or in one step when possible; minimal task breakdown',
      intensity_standard: 'Standard',
      intensity_standardDesc: 'The orchestrator decides collaboration depth as needed',
      intensity_strict: 'Strict',
      intensity_strictDesc: 'Complex tasks automatically wrap up with a review'
    },
    newProjectModal: {
      invite: 'Invite members',
      selected: 'Selected {sel}/{total} (all = everyone; new agents auto-join)',
      pickDirError: 'Failed to select directory',
      createError: 'Failed to create project — make sure the backend is running',
      titleChoose: 'New project',
      titleBlank: 'New blank project',
      titleFolder: 'Open project folder',
      useExisting: 'Use an existing folder',
      useExistingDesc: 'Select a local project directory',
      blank: 'New blank project',
      blankDesc: 'Start a new project from scratch',
      create: 'Create project',
      projectName: 'Project name',
      projectNamePlaceholder: 'Enter a project name'
    }
  },
  agents: {
    page: {
      title: 'Agent management',
      subtitle: 'View and configure collaborating agents — custom roles, skills, and groups',
      add: 'Add agent',
      loadErrorTitle: 'Failed to load the agent list',
      loadErrorDesc: 'Make sure the AgentHub engine is ready',
      retry: 'Retry',
      loading: 'Loading agents…',
      emptyTitle: 'No agents yet',
      emptyDesc: 'Click “Add agent” in the top-right to create your first agent',
      enabled: 'Enabled',
      disabled: 'Disabled',
      customRole: 'Custom role: {role}',
      independentProvider: 'Dedicated provider',
      config: 'Configure',
      enable: 'Enable',
      disable: 'Disable'
    },
    form: {
      name: 'Name',
      namePlaceholder: 'Agent name',
      role: 'Role ID',
      rolePlaceholder: 'e.g. coder, tester, doc-writer (custom)',
      desc: 'Description',
      descPlaceholder: "The agent's responsibilities — injected into its system prompt",
      skills: 'Skills',
      skillsPlaceholder: 'Comma-separated, e.g. React, unit testing, SQL tuning',
      group: 'Group label',
      groupPlaceholder: 'e.g. core, frontend',
      adapter: 'Adapter type',
      model: 'Model',
      modelPlaceholder: 'Leave blank to use the SDK default model',
      modelLocalPlaceholder: 'Local default: {model} (leave blank to keep)',
      provider: 'API provider',
      providerHint:
        'Default uses the local {adapter} login/config; custom makes only this agent use the provider you enter. codex and claude-code are stored independently',
      providerModeDefault: 'Default (local config)',
      providerModeProfile: 'Provider',
      providerModeCustom: 'Custom',
      profileSelect: 'Select a provider profile…',
      profileEmpty: 'No provider profiles for this tool; create one on the Providers page',
      profilePick: 'Please select a provider profile',
      localConfig: 'Detected local config',
      rescan: 'Rescan',
      scanning: 'Scanning…',
      notDetected: 'No local {adapter} config detected (will use the SDK default login)',
      authSource: {
        api_key: 'API key configured',
        chatgpt_login: 'ChatGPT login',
        cli_login: 'CLI login',
        env: 'Env credentials',
        settings: 'settings.json credentials',
        none: 'No credentials detected'
      },
      baseUrlPlaceholderCodex: 'e.g. https://api.deepseek.com/v1',
      baseUrlPlaceholderClaude: 'e.g. https://api.moonshot.cn/anthropic'
    },
    modal: {
      configTitle: 'Configure {name}',
      addTitle: 'Add agent',
      orchestratorLocked: 'orchestrator is a fixed system role and cannot be added'
    },
    notify: {
      saveFailed: 'Failed to save agent',
      createFailed: 'Failed to create agent',
      loadFailed: 'Failed to load the agent list',
      enableFailed: 'Failed to enable agent',
      disableFailed: 'Failed to disable agent',
      retryLater: 'Please try again later',
      engineReady: 'Make sure the AgentHub engine is ready'
    },
    roleDesc: {
      orchestrator:
        'Orchestration hub — automatically breaks down requirements and coordinates other agents.',
      planner:
        'Analyzes project structure, designs an implementation plan, and outputs a detailed technical plan.',
      coder:
        'Makes code changes, adds features, and fixes bugs per the plan — outputs an applicable diff.',
      reviewer: "Reviews the coder's output, surfaces potential issues, and suggests improvements.",
      deployer: 'Builds and deploys the code to the target environment; runs after user approval.'
    }
  },
  manage: {
    page: {
      title: 'Management',
      subtitle: 'Manage MCP servers, the skill library, and the rule library in one place',
      tabSkills: 'Skills',
      tabRules: 'Rules'
    },
    status: {
      pending: 'Connecting',
      connected: 'Connected',
      failed: 'Failed',
      disabled: 'Disabled',
      needs_auth: 'Needs auth',
      needs_client_registration: 'Needs registration'
    },
    mcpKind: { local: 'Local process', remote: 'Remote service' },
    ruleKind: { instruction: 'Instruction file', permission: 'Tool permissions' },
    actionLabel: { allow: 'Allow', ask: 'Ask', deny: 'Deny' },
    detail: { namePlaceholder: 'Name', enabled: 'Enabled', disabled: 'Disabled', delete: 'Delete' },
    mcp: {
      searchPlaceholder: 'Search MCP servers',
      createLabel: 'New MCP server',
      summary: '{enabled}/{total} enabled',
      empty: 'No MCP servers yet',
      unnamed: 'Unnamed server',
      emptyDetail: 'Select an MCP server on the left, or click + to create one',
      newName: 'New MCP server'
    },
    skills: {
      searchPlaceholder: 'Search skills',
      createLabel: 'New skill',
      summary: '{count} skills',
      empty: 'No skills yet',
      unnamed: 'Unnamed skill',
      defaultCategory: 'Skill',
      fileCount: '{count} files',
      emptyDetail: 'Select a skill on the left, or click + to create one'
    },
    rules: {
      searchPlaceholder: 'Search rules',
      createLabel: 'New rule',
      summary: '{count} rules',
      empty: 'No rules yet',
      unnamed: 'Unnamed rule',
      noDesc: 'No description',
      emptyDetail: 'Select a rule on the left, or click + to create one',
      newName: 'New rule'
    },
    picker: {
      all: 'All {total}',
      selectAll: 'Select all',
      clear: 'Clear',
      manage: 'Manage',
      manageTitle: 'Manage in the floating panel',
      searchPrefix: 'Search {title}',
      noMatch: 'No matches'
    },
    mcpEditor: {
      autoCheck: 'Auto-checked',
      recheck: 'Recheck',
      connection: 'Connection',
      command: 'Start command',
      commandHint: 'One token per line; the first line is the executable',
      env: 'Environment variables',
      envHint: 'KEY=VALUE, one per line',
      url: 'Service URL',
      headers: 'Headers',
      oauth: 'OAuth',
      oauthHint:
        'Enable when the remote service requires authorization (dynamic registration supported)',
      on: 'On',
      off: 'Off',
      timeout: 'Timeout (ms)',
      timeoutHint: 'Leave blank to use the default 5000',
      desc: 'Description',
      descPlaceholder: 'A one-line description of what this server does'
    },
    mcpRepo: {
      parseError: 'Failed to parse JSON — check the format',
      applied: 'Applied: {count} servers total (status will auto-recheck)',
      reverted: 'Reverted to current repository content',
      back: 'Back to list',
      heading: 'Full MCP repo · opencode mcp format',
      revert: 'Revert',
      apply: 'Apply repo'
    },
    skillOrigin: { manual: 'Created manually', local: 'Local folder', remote: 'Remote URL' },
    skillEditor: {
      descLabel: 'Description',
      descHint: "Maps to SKILL.md's frontmatter description",
      descPlaceholder: "A one-line description of the skill's purpose and triggers",
      category: 'Category',
      categoryPlaceholder: 'e.g. Dev / Testing / Docs',
      folder: 'Skill folder',
      newFile: 'New file',
      locked: 'Locked',
      skillMdNoRename: 'SKILL.md cannot be renamed',
      pathHint: 'Enter a path with “/” to move into a subfolder, e.g. scripts/run.sh',
      skillMdNoDelete: 'SKILL.md cannot be deleted',
      deleteFile: 'Delete file',
      skillMdPlaceholder:
        '---\nname: Skill name\ndescription: Brief description\n---\n\nWrite the skill instructions, steps, and examples here…',
      filePlaceholder: 'File content (scripts / references / assets)…',
      pickFile: 'Select a file on the left to edit'
    },
    addSkill: {
      title: 'Add skill',
      blank: 'New empty skill',
      blankSub: 'SKILL.md only',
      fromLocal: 'Import from local folder',
      fromLocalSub: 'e.g. ~/.agents/skills/foo',
      fromUrl: 'Import from URL',
      fromUrlSub: 'Remote skill index URL',
      localPath: 'Local folder path',
      remoteUrl: 'Remote skill URL',
      back: 'Back',
      import: 'Import'
    },
    ruleEditor: {
      type: 'Rule type',
      desc: 'Description',
      descPlaceholder: 'A one-line description of this rule',
      content: 'Instruction content',
      contentHint: 'Markdown, injected as session instructions (like AGENTS.md)',
      contentPlaceholder:
        'e.g. Every commit must include tests; explain the WHY from the user\u2019s perspective first…',
      permsTitle: 'Tool permissions · set each to Allow / Ask / Deny'
    },
    data: {
      cmdEmpty: 'Start command is empty',
      urlInvalid: 'Invalid service URL',
      newSkill: 'New skill',
      importSkill: 'Imported skill',
      importRule: 'Imported rule',
      seedMcpDesc: 'Local filesystem read/write (example)',
      seedSkillName: 'Code review',
      seedSkillCategory: 'Dev',
      seedSkillDesc: 'A systematic code-review checklist and key points',
      seedSkillContent:
        '---\nname: Code review\ndescription: A systematic code-review checklist and key points\n---\n\nDuring review, focus on: correctness, edge cases, error handling, naming and readability, test coverage, and security.',
      seedRuleStyleName: 'English output',
      seedRuleStyleDesc: 'Unify the reply language',
      seedRuleStyleContent: 'Reply in English except for code and proper nouns.',
      seedRulePermName: 'Careful execution',
      seedRulePermDesc: 'Dangerous operations require confirmation'
    },
    groupModal: {
      title: 'Group resources',
      subtitle: '{name} · checked items are enabled for this group; unchecked = not loaded',
      tabSkills: 'Skills',
      tabRules: 'Rules',
      typeMcp: 'MCP server',
      typeSkill: 'skill',
      typeRule: 'rule',
      searchPrefix: 'Search {type}',
      createPrefix: 'New {type}',
      import: 'Import',
      importNotFound: 'No valid data parsed — check the JSON format',
      importSuccess: 'Imported {count} items',
      confirmImport: 'Confirm import',
      enableInGroupPrefix: 'Enabled for this group',
      enableAll: 'All {total}',
      selectAll: 'Select all',
      clear: 'Clear',
      emptyNew: 'No {type} yet — click + to create or import',
      noMatch: 'No matches',
      disabledInRepo: 'Disabled in the library and cannot be enabled',
      enabledInGroup: 'Enabled for this group',
      notEnabledInGroup: 'Not enabled for this group',
      unnamed: 'Unnamed {type}',
      disabledBadge: 'Disabled',
      deleteFromRepo: 'Delete from library',
      enabledLabel: 'Enabled',
      disabledLabel: 'Disabled',
      pickItem: 'Select an item on the left to edit, or create / import',
      footerSummary: 'Enabled for this group: MCP {mcp} · Skills {skills} · Rules {rules}',
      editMcpJson: 'Edit full MCP JSON',
      checkAllMcp: 'Check all MCP online status',
      saveError: 'Save failed — make sure the AgentHub engine is ready',
      mcpImportPlaceholder:
        'Paste standard mcpServers JSON, e.g.:\n{\n  "mcpServers": {\n    "filesystem": {\n      "command": "npx",\n      "args": ["-y", "@modelcontextprotocol/server-filesystem", "."]\n    }\n  }\n}',
      skillImportPlaceholder:
        'Paste skill JSON (single or array): {"name":"Code review","description":"...","files":[{"path":"SKILL.md","content":"..."}]}',
      ruleImportPlaceholder:
        'Paste rule JSON (single or array): {"name":"English output","kind":"instruction","content":"..."} or {"name":"Careful execution","kind":"permission","permissions":{"bash":"ask"}}'
    }
  },
  settings: {
    title: 'Settings',
    sections: {
      engine: 'Engine',
      engineDesc: 'View backend engine status and restart',
      notify: 'Notifications',
      notifyDesc: 'Notifications for task completion, approvals, and more',
      theme: 'Appearance',
      themeDesc: 'Theme color, font size, language'
    },
    engine: {
      heading: 'Backend engine',
      statusLine: 'AgentHub engine: {status}',
      hint: 'The backend runs as a built-in child process of the main app and starts with it — no address to configure',
      restart: 'Restart engine'
    },
    notify: {
      heading: 'Notification settings',
      taskDone: 'Task completion',
      taskDoneDesc: 'Notify when an agent finishes a task',
      approval: 'Approval reminders',
      approvalDesc: 'Prompt when an action is awaiting approval',
      error: 'Error alerts',
      errorDesc: 'Notify when an agent runs into an error'
    },
    theme: {
      heading: 'Appearance settings',
      theme: 'Theme',
      light: 'Light',
      dark: 'Dark',
      system: 'System',
      language: 'Language',
      fontSize: 'Font size',
      fontSmall: 'Small (12px)',
      fontDefault: 'Default (14px)',
      fontLarge: 'Large (16px)'
    }
  }
}
