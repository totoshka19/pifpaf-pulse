'use client'

import { useRef } from 'react'
import { plural } from '@/lib/format/plural'
import type { FeedRange, FeedSort, FeedState, FeedView } from '@/lib/reels/filter'

const SORTS: { value: FeedSort; label: string }[] = [
  { value: 'added', label: 'Недавно добавленные' },
  { value: 'date', label: 'По дате публикации' },
  { value: 'views', label: 'По просмотрам' },
  { value: 'growth', label: 'По приросту за неделю' },
]

const RANGES: { value: FeedRange; label: string }[] = [
  { value: 'all', label: 'За всё время' },
  { value: '30d', label: 'За месяц' },
  { value: '7d', label: 'За неделю' },
]

const VIEWS: { value: FeedView; label: string }[] = [
  { value: 'grid', label: 'Сетка' },
  { value: 'table', label: 'Таблица' },
]

type Props = {
  state: FeedState
  onChange: (next: FeedState) => void
  total: number
  shown: number
}

const select =
  'rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]'

export function FeedControls({ state, onChange, total, shown }: Props) {
  const patch = (part: Partial<FeedState>) => onChange({ ...state, ...part })

  // role="radio" сама по себе меняет только то, что слышит скринридер —
  // клавиатурное поведение нативного <input type="radio"> (стрелки, один
  // Tab-стоп на группу) она не даёт. Roving tabIndex и обработчик стрелок
  // ниже подключены руками: без них Tab останавливался бы на обеих кнопках,
  // а стрелки не делали бы вообще ничего, хотя скринридер уже объявил бы
  // «radio group, 1 of 2» и подготовил пользователя именно к такому вводу.
  const viewRefs = useRef<(HTMLButtonElement | null)[]>([])

  const selectView = (index: number) => {
    patch({ view: VIEWS[index].value })
    viewRefs.current[index]?.focus()
  }

  const onViewKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault()
      selectView((index + 1) % VIEWS.length)
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault()
      selectView((index - 1 + VIEWS.length) % VIEWS.length)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={state.text}
          onChange={(event) => patch({ text: event.target.value })}
          placeholder="Поиск по подписи или автору"
          className={`${select} min-w-0 flex-1`}
          aria-label="Поиск по ленте"
        />

        <select
          value={state.sort}
          onChange={(event) => patch({ sort: event.target.value as FeedSort })}
          className={select}
          aria-label="Сортировка"
        >
          {SORTS.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>

        <select
          value={state.range}
          onChange={(event) => patch({ range: event.target.value as FeedRange })}
          className={select}
          aria-label="Период"
        >
          {RANGES.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>

        {/* Переключатель вида — radiogroup, а не две кнопки: так он озвучивается
            скринридером как один выбор из двух, а не два независимых действия.
            Стрелки и roving tabIndex у кнопок ниже — ручная реализация APG
            radio pattern, роль сама по себе их не даёт (см. комментарий выше). */}
        <div role="radiogroup" aria-label="Вид ленты" className="flex rounded-xl bg-[var(--surface)] p-1">
          {VIEWS.map((item, index) => (
            <button
              key={item.value}
              ref={(el) => {
                viewRefs.current[index] = el
              }}
              type="button"
              role="radio"
              aria-checked={state.view === item.value}
              tabIndex={state.view === item.value ? 0 : -1}
              onClick={() => selectView(index)}
              onKeyDown={(event) => onViewKeyDown(event, index)}
              className={`rounded-lg px-3 py-1.5 text-sm transition ${
                state.view === item.value
                  ? 'bg-[var(--accent-soft)] font-medium'
                  : 'text-[var(--muted)] hover:text-[var(--ink)]'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <p className="text-xs text-[var(--muted)]" aria-live="polite">
        {shown === total
          ? `${total} ${plural(total, ['рилс', 'рилса', 'рилсов'])}`
          : `${shown} из ${total} ${plural(total, ['рилса', 'рилсов', 'рилсов'])}`}
      </p>
    </div>
  )
}
