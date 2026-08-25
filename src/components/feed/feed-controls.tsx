'use client'

import { plural } from '@/lib/format/plural'
import type { FeedRange, FeedSort, FeedState, FeedView } from '@/lib/reels/filter'
import { Segmented } from '@/components/ui/segmented'
import { SelectMenu } from '@/components/ui/select-menu'

const SORTS: { value: FeedSort; label: string }[] = [
  { value: 'added', label: 'Недавно добавленные' },
  { value: 'date', label: 'По дате публикации' },
  { value: 'views', label: 'По просмотрам' },
  { value: 'growth', label: 'По приросту за неделю' },
]

// Подписи короче, чем были у нативного списка: три сегмента с «За всё время»
// не влезали в строку на телефоне. Полная фраза уходит в `spoken` — вслух
// «всё» без контекста не значит ничего. Значения и порядок те же, что у
// переключателя на дашборде (stats/range-switch.tsx).
const RANGES: { value: FeedRange; label: string; spoken: string }[] = [
  { value: 'all', label: 'всё', spoken: 'за всё время' },
  { value: '30d', label: 'месяц', spoken: 'за месяц' },
  { value: '7d', label: 'неделя', spoken: 'за неделю' },
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

/**
 * Поле поиска. Единственный оставшийся здесь нативный контрол — у `input`
 * нет раскрывающегося слоя, который рисовала бы ОС, поэтому стилизуется он
 * полностью и заменять его нечем и незачем.
 */
const search =
  'rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]'

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
          className={`${search} min-w-0 flex-1`}
          aria-label="Поиск по ленте"
        />

        {/* Сортировка — свой список, а не <select>: четыре длинных подписи
            сегментами растянулись бы на пол-экрана, а раскрытый нативный
            список не стилизуется (подробности в select-menu.tsx). */}
        <SelectMenu
          options={SORTS}
          value={state.sort}
          onChange={(sort: FeedSort) => patch({ sort })}
          label="Сортировка"
        />

        {/* Период и вид — сегменты: вариантов мало и подписи короткие,
            выпадающий список для трёх слов был бы лишним кликом. */}
        <Segmented
          options={RANGES}
          value={state.range}
          onChange={(range: FeedRange) => patch({ range })}
          label="Период"
        />

        <Segmented
          options={VIEWS}
          value={state.view}
          onChange={(view: FeedView) => patch({ view })}
          label="Вид ленты"
        />
      </div>

      <p className="text-xs text-[var(--muted)]" aria-live="polite">
        {shown === total
          ? `${total} ${plural(total, ['рилс', 'рилса', 'рилсов'])}`
          : `${shown} из ${total} ${plural(total, ['рилса', 'рилсов', 'рилсов'])}`}
      </p>
    </div>
  )
}
