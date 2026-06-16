import { useState } from 'react'
import { MasterDetail, ListItem, EmptyDetail, DetailHeader } from './MasterDetail'
import { RuleEditor } from './ResourceEditors'
import { useRules, ruleStore, newId, type RuleKind } from './mgmtData'
import { useT } from '../../i18n'

const KIND_KEY: Record<RuleKind, string> = {
  instruction: 'manage.ruleKind.instruction',
  permission: 'manage.ruleKind.permission'
}

export function RulesManager(): React.JSX.Element {
  const tr = useT()
  const items = useRules()
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const q = search.trim().toLowerCase()
  const filtered = q
    ? items.filter((i) =>
        [i.name, i.description, i.content].some((f) => f.toLowerCase().includes(q))
      )
    : items
  const selected = items.find((i) => i.id === selectedId) ?? null

  const create = (): void => {
    const id = newId()
    ruleStore.add({
      id,
      name: tr('manage.rules.newName'),
      enabled: true,
      kind: 'instruction',
      description: '',
      content: '',
      permissions: {}
    })
    setSelectedId(id)
  }

  return (
    <MasterDetail
      searchPlaceholder={tr('manage.rules.searchPlaceholder')}
      search={search}
      onSearch={setSearch}
      createLabel={tr('manage.rules.createLabel')}
      onCreate={create}
      summary={tr('manage.rules.summary', { count: items.length })}
      list={
        filtered.length === 0 ? (
          <p className="text-xs text-center py-8" style={{ color: 'var(--color-text-tertiary)' }}>
            {tr('manage.rules.empty')}
          </p>
        ) : (
          filtered.map((it) => (
            <ListItem
              key={it.id}
              active={it.id === selectedId}
              enabled={it.enabled}
              title={it.name || tr('manage.rules.unnamed')}
              subtitle={`${tr(KIND_KEY[it.kind])} · ${it.description || tr('manage.rules.noDesc')}`}
              accent="var(--color-warning)"
              onClick={() => setSelectedId(it.id)}
            />
          ))
        )
      }
      detail={
        selected ? (
          <div className="max-w-2xl px-8 py-6">
            <DetailHeader
              title={selected.name}
              onTitleChange={(v) => ruleStore.update(selected.id, { name: v })}
              onDelete={() => {
                ruleStore.remove(selected.id)
                setSelectedId(null)
              }}
            />
            <RuleEditor item={selected} />
          </div>
        ) : (
          <EmptyDetail message={tr('manage.rules.emptyDetail')} />
        )
      }
    />
  )
}
