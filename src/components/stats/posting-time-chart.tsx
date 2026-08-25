'use client'

import { useState } from 'react'
import { formatCount } from '@/lib/format/number'
import { plural } from '@/lib/format/plural'
import type { HeatmapCell, HeatmapRow } from '@/lib/stats/chart-data'

/**
 * Гистограмма «когда лучше постить»: сетка «день недели × час» по времени
 * ПУБЛИКАЦИИ в московском поясе.
 *
 * Recharts здесь не нужен и намеренно не используется: тепловая карта — это
 * сетка div'ов, и тащить ради неё 331 КБ было бы расточительством. Клиентский
 * компонент только из-за подсказки при наведении и фокусе.
 *
 * Данные приходят готовой сеткой 7 × 24 из `toPostingHeatmap`: пустые клетки
 * уже дорисованы, насыщенность уже посчитана. Здесь только вёрстка.
 */

/** Часы подписываем через три: двадцать четыре подписи не читаются нигде. */
const LABELLED_HOURS = [0, 3, 6, 9, 12, 15, 18, 21]

function cellTitle(row: HeatmapRow, cell: HeatmapCell): string {
  const when = `${row.label}, ${String(cell.hour).padStart(2, '0')}:00`

  if (cell.reelsCount === 0) return `${when} — рилсов не было`

  const count = `${cell.reelsCount} ${plural(cell.reelsCount, ['рилс', 'рилса', 'рилсов'])}`

  // Просмотров может не быть, даже когда рилс есть: его могли ещё не опросить.
  return cell.avgViews === null
    ? `${when} — ${count}, просмотров пока нет`
    : `${when} — ${count}, в среднем ${formatCount(cell.avgViews)} просмотров`
}

export function PostingTimeChart({ grid }: { grid: HeatmapRow[] }) {
  const [hovered, setHovered] = useState<string | null>(null)

  return (
    <div className="flex flex-col gap-3">
      {/* Прокрутка ВНУТРИ рамки, а не у страницы: двадцать четыре колонки
          на 375px не помещаются никак. Тот же приём, что у таблицы ленты. */}
      <div className="-mx-1 overflow-x-auto px-1 pb-1">
        <div className="min-w-[520px]">
          <div className="flex flex-col gap-1">
            {grid.map((row) => (
              <div key={row.weekday} className="flex items-center gap-1">
                <span className="w-7 shrink-0 text-[11px] text-[var(--muted)]">{row.label}</span>

                {row.hours.map((cell) => {
                  const key = `${row.weekday}:${cell.hour}`

                  return (
                    <div
                      key={cell.hour}
                      // tabIndex только у непустых: пробегать Tab'ом сто
                      // шестьдесят восемь пустых клеток — издевательство.
                      tabIndex={cell.reelsCount > 0 ? 0 : undefined}
                      title={cellTitle(row, cell)}
                      aria-label={cell.reelsCount > 0 ? cellTitle(row, cell) : undefined}
                      onMouseEnter={() => setHovered(key)}
                      onMouseLeave={() => setHovered(null)}
                      onFocus={() => setHovered(key)}
                      onBlur={() => setHovered(null)}
                      className="h-6 flex-1 rounded-[3px] border border-[var(--border)]"
                      style={{
                        // Прозрачность считается из intensity: чем выше
                        // средние просмотры слота, тем плотнее заливка.
                        // Минимум 0.12 у непустых — иначе слабый слот
                        // неотличим от отсутствия рилсов вовсе.
                        backgroundColor:
                          cell.reelsCount > 0
                            ? `color-mix(in srgb, var(--accent) ${Math.round(
                                Math.max(0.12, cell.intensity) * 100,
                              )}%, transparent)`
                            : 'rgba(15, 23, 42, 0.03)',
                        outline: hovered === key ? '2px solid var(--accent)' : undefined,
                      }}
                    />
                  )
                })}
              </div>
            ))}

            {/* Ось часов */}
            <div className="mt-1 flex items-center gap-1">
              <span className="w-7 shrink-0" />
              {Array.from({ length: 24 }, (_, hour) => (
                <span
                  key={hour}
                  className="flex-1 text-center text-[10px] text-[var(--muted)]"
                >
                  {LABELLED_HOURS.includes(hour) ? hour : ''}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      <p className="text-xs text-[var(--muted)]">
        Чем плотнее клетка, тем больше в среднем набирают рилсы, выложенные
        в это время. Часы московские.
      </p>
    </div>
  )
}
