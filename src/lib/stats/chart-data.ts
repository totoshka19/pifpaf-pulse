import type { PostingSlot } from '@/db/queries/stats-posting-time'
import type { TimeseriesPoint } from '@/db/queries/stats-timeseries'
import type { DetailSnapshot } from '@/db/queries/reel-detail'
import { formatDayHourMsk, formatIsoDayShort } from '@/lib/format/date'
import { formatExact } from '@/lib/format/number'

/**
 * Приведение рядов к форме, которую ждёт Recharts.
 *
 * Recharts исполняется НА КЛИЕНТЕ. Всё, что можно посчитать заранее,
 * считается здесь, на сервере, и приезжает готовыми строками и числами.
 * Отдать графику `Date` значит дать браузеру отформатировать её своим
 * поясом — и московское время, ради которого написан весь SQL, потеряется
 * на последнем шаге.
 */

export type ChartPoint = {
  /** Подпись на оси: «24 авг». */
  label: string
  value: number
  /** Точное число для тултипа: «1 245 903». */
  title: string
}

/** Точки графика динамики просмотров. Порядок дней сохраняется как есть. */
export function toViewsSeries(points: TimeseriesPoint[]): ChartPoint[] {
  return points.map((point) => ({
    // День приходит из SQL уже московским — берём строку как есть,
    // без обратного превращения в Date. См. formatIsoDayShort.
    label: formatIsoDayShort(point.day),
    value: point.totalViews,
    title: formatExact(point.totalViews),
  }))
}

/**
 * Точки графика роста одного рилса.
 *
 * Снапшоты со скрытыми просмотрами ОТБРАСЫВАЮТСЯ, а не превращаются в ноль:
 * `null` означает «Instagram не отдал число» (лайки бывают скрыты, метрики
 * приходят частично), и точка на нуле нарисовала бы обвал, которого не было.
 * Пропуск честнее: линия просто соединит соседние известные замеры.
 */
export function toGrowthSeries(snapshots: DetailSnapshot[]): ChartPoint[] {
  return snapshots
    .filter((snapshot): snapshot is DetailSnapshot & { views: number } => snapshot.views !== null)
    .map((snapshot) => ({
      label: formatDayHourMsk(snapshot.capturedAt),
      value: snapshot.views,
      title: formatExact(snapshot.views),
    }))
}

export type HeatmapCell = {
  hour: number
  reelsCount: number
  avgViews: number | null
  /** 0…1 — доля от лучшего слота набора. Готовая непрозрачность для заливки. */
  intensity: number
}

export type HeatmapRow = {
  /** 1 — понедельник … 7 — воскресенье. */
  weekday: number
  label: string
  /** Ровно двадцать четыре часа, включая пустые. */
  hours: HeatmapCell[]
}

const WEEKDAY_LABELS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'] as const

const HOURS_IN_DAY = 24

/**
 * Разрежённые слоты из SQL → полная сетка 7 × 24.
 *
 * Сетка полная НАМЕРЕННО. Запрос отдаёт только те слоты, где что-то есть, —
 * их может быть два на весь кабинет. Дорисовывать пустые клетки в компоненте
 * значило бы держать эту логику в клиентском коде и повторять её в каждом
 * графике. Здесь она одна, проверена тестами, и компонент только рисует.
 *
 * Насыщенность нормируется по СРЕДНИМ ПРОСМОТРАМ, а не по числу рилсов:
 * вопрос гистограммы — «когда выкладывать, чтобы посмотрели», а не «когда
 * я обычно выкладываю».
 */
export function toPostingHeatmap(slots: PostingSlot[]): HeatmapRow[] {
  // Максимум по набору. Деления на ноль не будет: делим только когда он > 0,
  // а не считаем размах (max − min), который на одинаковых значениях
  // схлопнулся бы в ноль и дал NaN.
  const best = slots.reduce((max, slot) => Math.max(max, slot.avgViews ?? 0), 0)

  const bySlot = new Map<string, PostingSlot>()
  for (const slot of slots) bySlot.set(`${slot.weekday}:${slot.hour}`, slot)

  return WEEKDAY_LABELS.map((label, index) => {
    const weekday = index + 1

    return {
      weekday,
      label,
      hours: Array.from({ length: HOURS_IN_DAY }, (_, hour) => {
        const slot = bySlot.get(`${weekday}:${hour}`)

        return {
          hour,
          reelsCount: slot?.reelsCount ?? 0,
          // Слот без просмотров — это не ноль просмотров: рилс мог быть
          // опубликован, но ещё ни разу не опрошен.
          avgViews: slot?.avgViews ?? null,
          intensity: best > 0 && slot?.avgViews ? slot.avgViews / best : 0,
        }
      }),
    }
  })
}
