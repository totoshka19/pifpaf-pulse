'use client'

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
  'rounded-xl border border-[var(--border)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--accent)]'

export function FeedControls({ state, onChange, total, shown }: Props) {
  const patch = (part: Partial<FeedState>) => onChange({ ...state, ...part })

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
            скринридером как один выбор из двух, и стрелки работают сами. */}
        <div role="radiogroup" aria-label="Вид ленты" className="flex rounded-xl bg-white p-1">
          {VIEWS.map((item) => (
            <button
              key={item.value}
              type="button"
              role="radio"
              aria-checked={state.view === item.value}
              onClick={() => patch({ view: item.value })}
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
