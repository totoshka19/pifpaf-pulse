import type { ChartPoint } from '@/lib/stats/chart-data'

/**
 * Текстовая альтернатива графику.
 *
 * Recharts рисует SVG из путей и кружков: скринридер прочтёт его как ничто.
 * `aria-label` на контейнере помог бы сказать «график просмотров», но не дал
 * бы НИ ОДНОГО ЧИСЛА — а числа и есть содержание.
 *
 * Поэтому рядом с каждым графиком лежит та же самая таблица. Она свёрнута
 * в `<details>`: зрячий пользователь её не видит, пока не откроет, а
 * скринридер и клавиатура добираются до неё обычным способом. Это честнее,
 * чем `sr-only`, — данные доступны всем, просто не занимают экран.
 *
 * Сам график при этом помечен `aria-hidden`: иначе скринридер зачитал бы
 * его внутренности как набор бессмысленных фрагментов поверх таблицы.
 */
export function ChartTable({
  points,
  caption,
  valueLabel,
  labelHeader = 'Дата',
}: {
  points: ChartPoint[]
  caption: string
  valueLabel: string
  labelHeader?: string
}) {
  if (points.length === 0) return null

  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-xs text-[var(--muted)] hover:text-[var(--ink)]">
        Показать числами ({points.length})
      </summary>

      <div className="mt-2 max-h-64 overflow-y-auto">
        <table className="w-full text-left text-xs">
          <caption className="sr-only">{caption}</caption>
          <thead className="text-[var(--muted)]">
            <tr>
              <th scope="col" className="py-1 font-normal">
                {labelHeader}
              </th>
              <th scope="col" className="py-1 font-normal">
                {valueLabel}
              </th>
            </tr>
          </thead>
          <tbody>
            {points.map((point) => (
              <tr key={point.label} className="border-t border-[var(--border)]">
                <th scope="row" className="py-1 font-normal">
                  {point.label}
                </th>
                <td className="py-1 tabular-nums">{point.title}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}
