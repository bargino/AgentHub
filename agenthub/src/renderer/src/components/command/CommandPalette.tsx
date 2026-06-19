import { useEffect, useState, useCallback } from 'react'
import {
  MessageSquare,
  Bot,
  SlidersHorizontal,
  Settings,
  Plus,
  Eye,
  ListTodo,
  Files,
  Monitor,
  Users
} from 'lucide-react'
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem
} from '../ui/command'
import { useAppStore, type PageType } from '../../store'
import type { RightTab } from '../../types'
import { useT } from '../../i18n'

/**
 * 全局命令面板：Cmd/Ctrl+K 打开，快速跳转会话 / 页面 / 面板与执行操作。
 * 组合键全局触发（输入框聚焦时也可用）；ReviewCenter 的裸 j/k 在按下 ctrl/meta 时已让行，无冲突。
 */
export function CommandPalette(): React.JSX.Element {
  const tr = useT()
  const [open, setOpen] = useState(false)
  const conversations = useAppStore((s) => s.conversations)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // 选中后先关面板再执行动作
  const run = useCallback((fn: () => void): void => {
    setOpen(false)
    fn()
  }, [])

  const goPage = (page: PageType): void => run(() => useAppStore.getState().setActivePage(page))

  const goConversation = (id: string): void =>
    run(() => {
      useAppStore.getState().setActivePage('chat')
      void useAppStore.getState().setActiveConversation(id)
    })

  // 直接 setState 确保「打开」（setRightTab 是 toggle 语义，重复点同一 tab 会收起）
  const openPanel = (tab: RightTab): void =>
    run(() => useAppStore.setState({ activePage: 'chat', rightTab: tab, groupPanelOpen: false }))

  const openGroup = (): void =>
    run(() => useAppStore.setState({ activePage: 'chat', groupPanelOpen: true, rightTab: null }))

  const newProject = (): void =>
    run(() => {
      useAppStore.getState().setActivePage('chat')
      useAppStore.getState().setNewProjectOpen(true)
    })

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title={tr('palette.title')}
      description={tr('palette.desc')}
    >
      <CommandInput placeholder={tr('palette.placeholder')} />
      <CommandList>
        <CommandEmpty>{tr('palette.empty')}</CommandEmpty>

        <CommandGroup heading={tr('palette.group.actions')}>
          <CommandItem value="new project newproject 新建项目" onSelect={newProject}>
            <Plus />
            <span>{tr('palette.newProject')}</span>
          </CommandItem>
        </CommandGroup>

        <CommandGroup heading={tr('palette.group.pages')}>
          <CommandItem value="chat page 会话 聊天" onSelect={() => goPage('chat')}>
            <MessageSquare />
            <span>{tr('nav.chat')}</span>
          </CommandItem>
          <CommandItem value="agents agent page" onSelect={() => goPage('agents')}>
            <Bot />
            <span>{tr('nav.agents')}</span>
          </CommandItem>
          <CommandItem value="manage page 管理中心" onSelect={() => goPage('manage')}>
            <SlidersHorizontal />
            <span>{tr('nav.manage')}</span>
          </CommandItem>
          <CommandItem value="settings page 设置" onSelect={() => goPage('settings')}>
            <Settings />
            <span>{tr('nav.settings')}</span>
          </CommandItem>
        </CommandGroup>

        <CommandGroup heading={tr('palette.group.panels')}>
          <CommandItem value="review diff approval 审查" onSelect={() => openPanel('review')}>
            <Eye />
            <span>{tr('palette.panel.review')}</span>
          </CommandItem>
          <CommandItem value="task panel 任务" onSelect={() => openPanel('task')}>
            <ListTodo />
            <span>{tr('palette.panel.task')}</span>
          </CommandItem>
          <CommandItem value="git files panel 文件" onSelect={() => openPanel('git')}>
            <Files />
            <span>{tr('palette.panel.git')}</span>
          </CommandItem>
          <CommandItem value="preview panel 预览" onSelect={() => openPanel('preview')}>
            <Monitor />
            <span>{tr('palette.panel.preview')}</span>
          </CommandItem>
          <CommandItem value="group settings panel 群设置" onSelect={openGroup}>
            <Users />
            <span>{tr('palette.panel.group')}</span>
          </CommandItem>
        </CommandGroup>

        {conversations.length > 0 && (
          <CommandGroup heading={tr('palette.group.conversations')}>
            {conversations.map((c) => (
              <CommandItem
                key={c.id}
                value={`conv ${c.title} ${c.projectName} ${c.id}`}
                onSelect={() => goConversation(c.id)}
              >
                <MessageSquare />
                <span className="truncate">{c.title}</span>
                <span
                  className="ml-auto text-xs opacity-60 truncate"
                  style={{ maxWidth: 120, color: 'var(--color-text-tertiary)' }}
                >
                  {c.projectName}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  )
}
