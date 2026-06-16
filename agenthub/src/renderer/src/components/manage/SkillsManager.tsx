import { useState } from 'react'
import { MasterDetail, ListItem, EmptyDetail, DetailHeader } from './MasterDetail'
import { SkillEditor, AddSkillMenu } from './ResourceEditors'
import { useSkills, skillStore, type SkillItem } from './mgmtData'
import { useT } from '../../i18n'

export function SkillsManager(): React.JSX.Element {
  const tr = useT()
  const items = useSkills()
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const q = search.trim().toLowerCase()
  const filtered = q
    ? items.filter((i) =>
        [i.name, i.category, i.description].some((f) => f.toLowerCase().includes(q))
      )
    : items
  const selected = items.find((i) => i.id === selectedId) ?? null

  const create = (skill: SkillItem): void => {
    skillStore.add(skill)
    setSelectedId(skill.id)
  }

  return (
    <MasterDetail
      searchPlaceholder={tr('manage.skills.searchPlaceholder')}
      search={search}
      onSearch={setSearch}
      createLabel={tr('manage.skills.createLabel')}
      onCreate={() => {}}
      createControl={<AddSkillMenu onCreate={create} />}
      summary={tr('manage.skills.summary', { count: items.length })}
      list={
        filtered.length === 0 ? (
          <p className="text-xs text-center py-8" style={{ color: 'var(--color-text-tertiary)' }}>
            {tr('manage.skills.empty')}
          </p>
        ) : (
          filtered.map((it) => (
            <ListItem
              key={it.id}
              active={it.id === selectedId}
              enabled={it.enabled}
              title={it.name || tr('manage.skills.unnamed')}
              subtitle={`${it.category || tr('manage.skills.defaultCategory')} · ${tr('manage.skills.fileCount', { count: it.files.length })}`}
              accent="var(--color-success)"
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
              onTitleChange={(v) => skillStore.update(selected.id, { name: v })}
              onDelete={() => {
                skillStore.remove(selected.id)
                setSelectedId(null)
              }}
            />
            <SkillEditor item={selected} />
          </div>
        ) : (
          <EmptyDetail message={tr('manage.skills.emptyDetail')} />
        )
      }
    />
  )
}
