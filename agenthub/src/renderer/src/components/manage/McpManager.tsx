import { useState } from 'react'
import { MasterDetail, ListItem, EmptyDetail, DetailHeader } from './MasterDetail'
import { McpEditor } from './ResourceEditors'
import { useMcpServers, mcpStore, newId, MCP_STATUS, useMcpAutoCheck } from './mgmtData'
import { useT } from '../../i18n'

const KIND_KEY = { local: 'manage.mcpKind.local', remote: 'manage.mcpKind.remote' } as const

export function McpManager(): React.JSX.Element {
  const tr = useT()
  const items = useMcpServers()
  useMcpAutoCheck()
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const q = search.trim().toLowerCase()
  const filtered = q
    ? items.filter((i) =>
        [i.name, i.description, i.url, i.command].some((f) => f.toLowerCase().includes(q))
      )
    : items
  const selected = items.find((i) => i.id === selectedId) ?? null
  const enabledCount = items.filter((i) => i.enabled).length

  const create = (): void => {
    const id = newId()
    mcpStore.add({
      id,
      name: tr('manage.mcp.newName'),
      enabled: true,
      kind: 'local',
      command: '',
      environment: '',
      url: '',
      headers: '',
      oauth: false,
      description: '',
      status: 'pending'
    })
    setSelectedId(id)
  }

  return (
    <MasterDetail
      searchPlaceholder={tr('manage.mcp.searchPlaceholder')}
      search={search}
      onSearch={setSearch}
      createLabel={tr('manage.mcp.createLabel')}
      onCreate={create}
      summary={tr('manage.mcp.summary', { enabled: enabledCount, total: items.length })}
      list={
        filtered.length === 0 ? (
          <p className="text-xs text-center py-8" style={{ color: 'var(--color-text-tertiary)' }}>
            {tr('manage.mcp.empty')}
          </p>
        ) : (
          filtered.map((it) => (
            <ListItem
              key={it.id}
              active={it.id === selectedId}
              enabled={it.enabled}
              title={it.name || tr('manage.mcp.unnamed')}
              subtitle={`${tr(KIND_KEY[it.kind])} · ${tr(MCP_STATUS[it.status].labelKey)}`}
              error={it.status === 'failed' ? it.statusError : undefined}
              accent={MCP_STATUS[it.status].color}
              onClick={() => setSelectedId(it.id)}
              onToggle={(v) => mcpStore.update(it.id, { enabled: v })}
            />
          ))
        )
      }
      detail={
        selected ? (
          <div className="max-w-2xl px-8 py-6">
            <DetailHeader
              title={selected.name}
              onTitleChange={(v) => mcpStore.update(selected.id, { name: v })}
              enabled={selected.enabled}
              onToggle={(v) => mcpStore.update(selected.id, { enabled: v })}
              onDelete={() => {
                mcpStore.remove(selected.id)
                setSelectedId(null)
              }}
            />
            <McpEditor item={selected} />
          </div>
        ) : (
          <EmptyDetail message={tr('manage.mcp.emptyDetail')} />
        )
      }
    />
  )
}
