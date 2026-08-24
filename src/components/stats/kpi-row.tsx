import type { StatsOverview } from '@/db/queries/stats-overview'
import { toKpiTiles } from '@/lib/stats/view-model'

/**
 * Строка KPI: пять чисел про кабинет целиком.
 *
 * Серверный компонент — считать нечего, интерактивности нет. Все строки
 * приходят готовыми из `toKpiTiles`, здесь только вёрстка.
 */
export function KpiRow({ overview }: { overview: StatsOverview }) {
  const tiles = toKpiTiles(overview)

  return (
    // Сетка, а не flex-wrap. Ловушка среза 5: перенос не срабатывает, если
    // элементам разрешено сжиматься, — управлять пришлось бы basis. У grid
    // ширина колонки задана явно, и на 375px плитки честно встают в два
    // столбца, а не сплющиваются в нечитаемое.
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {tiles.map((tile) => (
        <div
          key={tile.label}
          className="flex flex-col gap-1 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--shadow)]"
        >
          <dt className="text-xs text-[var(--muted)]">{tile.label}</dt>

          <dd
            // Точное число всплывает по наведению: «1,2 млн» удобно читать,
            // но иногда нужна каждая цифра.
            title={tile.title}
            className={`text-2xl font-semibold tabular-nums tracking-tight ${
              tile.trend === 'up'
                ? 'text-[var(--up)]'
                : tile.trend === 'down'
                  ? 'text-[var(--down)]'
                  : ''
            }`}
          >
            {tile.trend && (
              // aria-hidden: стрелка дублирует знак «+» или «−», который уже
              // есть в самом числе. Скринридеру она добавила бы «вверх»
              // к «плюс двенадцать тысяч» — шум, а не смысл.
              <span aria-hidden className="mr-1 text-base">
                {tile.trend === 'up' ? '↑' : '↓'}
              </span>
            )}
            {tile.value}
          </dd>

          {tile.hint && <p className="text-xs text-[var(--muted)]">{tile.hint}</p>}
        </div>
      ))}
    </dl>
  )
}
