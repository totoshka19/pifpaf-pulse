'use client'

import { ReelCover } from '@/components/reel-cover'
import type { FeedSort } from '@/lib/reels/filter'
import type { ReelCardModel } from '@/lib/reels/view-model'

type Props = {
  cards: ReelCardModel[]
  sort: FeedSort
  onSort: (sort: FeedSort) => void
  onSync: (id: string) => void
  onDelete: (id: string) => void
}

/** Колонки, по которым можно сортировать кликом по заголовку. */
const SORTABLE: { key: FeedSort; label: string }[] = [
  { key: 'date', label: 'Дата' },
  { key: 'views', label: 'Просмотры' },
  { key: 'growth', label: 'За неделю' },
]

export function ReelsTable({ cards, sort, onSort, onSync, onDelete }: Props) {
  return (
    // Горизонтальная прокрутка — единственный честный способ показать девять
    // колонок на экране в 375 px. Схлопывать таблицу в карточки бессмысленно:
    // тогда это просто вторая сетка.
    <div className="overflow-x-auto rounded-[var(--radius)] border border-[var(--border)] bg-white">
      <table className="w-full min-w-[720px] border-collapse text-sm">
        <thead className="bg-[var(--accent-soft)]/40 text-left text-xs text-[var(--muted)]">
          <tr>
            <th className="px-3 py-2 font-medium">Рилс</th>
            {SORTABLE.map((column) => (
              <th key={column.key} className="px-3 py-2 font-medium">
                <button
                  type="button"
                  onClick={() => onSort(column.key)}
                  aria-sort={sort === column.key ? 'descending' : 'none'}
                  className="flex items-center gap-1 hover:text-[var(--ink)]"
                >
                  {column.label}
                  <span aria-hidden className={sort === column.key ? '' : 'opacity-0'}>
                    ↓
                  </span>
                </button>
              </th>
            ))}
            <th className="px-3 py-2 font-medium">Лайки</th>
            <th className="px-3 py-2 font-medium">Комменты</th>
            <th className="px-3 py-2 font-medium">ER</th>
            <th className="px-3 py-2 font-medium">Обновлено</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>

        <tbody>
          {cards.map((card) => (
            <tr key={card.id} className="border-t border-[var(--border)] hover:bg-[var(--bg)]/60">
              <td className="px-3 py-2">
                <a
                  href={card.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2"
                >
                  <span className="w-9 shrink-0">
                    <ReelCover
                      reelId={card.id}
                      author={card.author}
                      caption={card.caption}
                      ratio="square"
                    />
                  </span>
                  <span className="line-clamp-1 max-w-[22ch]">{card.caption}</span>
                </a>
              </td>

              <td className="px-3 py-2 whitespace-nowrap" title={card.postedTitle}>
                {card.postedShort}
              </td>
              <td className="px-3 py-2 font-medium whitespace-nowrap" title={card.viewsTitle}>
                {card.views}
              </td>
              <td className="px-3 py-2 whitespace-nowrap">
                {card.growth ? (
                  <span style={{ color: card.growth.direction === 'up' ? 'var(--up)' : 'var(--down)' }}>
                    {card.growth.text}
                  </span>
                ) : (
                  '—'
                )}
              </td>
              <td className="px-3 py-2">{card.likes}</td>
              <td className="px-3 py-2">{card.comments}</td>
              <td className="px-3 py-2">{card.er}</td>
              <td className="px-3 py-2 text-xs text-[var(--muted)] whitespace-nowrap">
                {card.message ?? card.updated ?? '—'}
              </td>

              <td className="px-3 py-2">
                <div className="flex justify-end gap-1 whitespace-nowrap">
                  {(card.canSync || card.canRetry) && (
                    <button
                      type="button"
                      onClick={() => onSync(card.id)}
                      className="rounded-lg border border-[var(--border)] px-2 py-1 text-xs hover:bg-[var(--accent-soft)]"
                    >
                      {card.canRetry ? 'Повторить' : 'Обновить'}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => onDelete(card.id)}
                    className="rounded-lg border border-[var(--border)] px-2 py-1 text-xs hover:bg-[var(--down)]/10"
                  >
                    Удалить
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
