import type { StatsOverview } from '@/db/queries/stats-overview'
import { formatCount, formatDelta, formatExact, NO_DATA } from '@/lib/format/number'
import { plural } from '@/lib/format/plural'

/** Неразрывный пробел: «0 %» не должно рваться переносом. */
const NBSP = ' '

export type KpiTile = {
  label: string
  /** Уже готовая строка. Компонент её только рисует. */
  value: string
  /** Точное число для `title` — всплывает по наведению. */
  title?: string
  /** Мелкая подпись под значением. */
  hint?: string
  trend?: 'up' | 'down'
}

/**
 * Пять чисел кабинета → готовые плитки.
 *
 * Форматирование живёт здесь, а не в компоненте: одна и та же плитка
 * рисуется на сервере и сверяется на клиенте, и любое расхождение — ошибка
 * гидрации, а не косметика.
 *
 * Плитка прироста ПРОПАДАЕТ, когда прирост посчитать не из чего. Показать
 * «+0» значило бы сказать «не выросло», тогда как честный ответ — «точек
 * пока мало». Остальные плитки на месте всегда: их отсутствие читалось бы
 * как поломка, а прочерк внутри — как «данных нет», что и требуется.
 */
export function toKpiTiles(overview: StatsOverview): KpiTile[] {
  const tiles: KpiTile[] = [
    {
      label: 'Всего рилсов',
      // Ноль рилсов — настоящий ноль, а не «нет данных».
      value: String(overview.reelsCount),
      hint: plural(overview.reelsCount, ['рилс', 'рилса', 'рилсов']),
    },
    {
      label: 'Просмотры',
      value: formatCount(overview.totalViews),
      title: formatExact(overview.totalViews),
    },
    {
      label: 'В среднем',
      value: formatCount(overview.avgViews),
      title: formatExact(overview.avgViews),
      hint: `на ${overview.reelsCount} ${plural(overview.reelsCount, [
        'рилс',
        'рилса',
        'рилсов',
      ])}`,
    },
    {
      label: 'Вовлечённость',
      // Ноль процентов бывает у рилса с просмотрами и без реакций — это
      // настоящий ноль. Прочерк — когда лайки скрыты или просмотров нет.
      value:
        overview.erPercent === null
          ? NO_DATA
          : `${String(overview.erPercent).replace('.', ',')}${NBSP}%`,
      hint: 'лайки и комментарии к просмотрам',
    },
  ]

  if (overview.growth7d !== null) {
    tiles.push({
      label: 'За неделю',
      value: formatDelta(overview.growth7d),
      title: formatExact(overview.growth7d),
      hint: 'прирост просмотров',
      // Ноль остаётся без стрелки: он не рост и не падение.
      trend: overview.growth7d > 0 ? 'up' : overview.growth7d < 0 ? 'down' : undefined,
    })
  }

  return tiles
}
