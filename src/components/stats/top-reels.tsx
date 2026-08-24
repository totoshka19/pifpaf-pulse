import Link from 'next/link'
import { ReelCover } from '@/components/reel-cover'
import type { ReelListRow } from '@/db/queries/list-reels'
import { toCardModel } from '@/lib/reels/view-model'

/**
 * Топ-3 рилса по просмотрам.
 *
 * Строки приходят из того же `listReels`, что кормит ленту, — четвёртого
 * запроса ради трёх карточек не пишем. Сортировку делает SQL (`sort: 'views'`),
 * здесь остаётся только срез.
 *
 * Серверный компонент: считать нечего. Клиентским остаётся только `<ReelCover>`
 * внутри — ему нужен обработчик ошибки загрузки картинки.
 */
export function TopReels({ rows, now }: { rows: ReelListRow[]; now: number }) {
  // Пустой блок не рисуем вовсе: за случай «рилсов нет» отвечает пустое
  // состояние дашборда, и два сообщения об одном и том же — шум.
  if (rows.length === 0) return null

  const top = rows.slice(0, 3).map((row) => toCardModel(row, new Date(now)))

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-base font-semibold">Лучшие рилсы</h2>
        <p className="text-xs text-[var(--muted)]">
          {top.length < 3 ? 'пока это всё, что есть' : 'три самых просматриваемых'}
        </p>
      </div>

      <ol className="grid gap-3 sm:grid-cols-3">
        {top.map((card, index) => (
          <li key={card.id}>
            <Link
              href={`/app/reels/${card.id}`}
              className="flex h-full items-center gap-3 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-3 shadow-[var(--shadow)] transition-colors hover:border-[var(--accent)]"
            >
              <div className="relative w-14 shrink-0">
                <ReelCover
                  reelId={card.id}
                  author={card.author}
                  caption={card.caption}
                  version={card.coverVersion}
                  ratio="square"
                />
                <span
                  // Место в тройке. aria-hidden: порядок уже несёт <ol>,
                  // и скринридер сам скажет «список из трёх, элемент один».
                  aria-hidden
                  className="absolute -left-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--accent)] text-[11px] font-semibold text-white"
                >
                  {index + 1}
                </span>
              </div>

              <div className="flex min-w-0 flex-col gap-0.5">
                <p className="line-clamp-2 text-sm leading-snug">{card.caption}</p>
                <p className="text-sm font-semibold tabular-nums" title={card.viewsTitle}>
                  {card.views}
                  <span className="ml-1 text-xs font-normal text-[var(--muted)]">
                    просмотров
                  </span>
                </p>
              </div>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  )
}
