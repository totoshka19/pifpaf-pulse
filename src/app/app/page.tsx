import type { Metadata } from 'next'
import Link from 'next/link'
import { ChartFrame } from '@/components/stats/chart-frame'
import { KpiRow } from '@/components/stats/kpi-row'
import { LazyViewsChart } from '@/components/stats/lazy-charts'
import { PostingTimeChart } from '@/components/stats/posting-time-chart'
import { RangeSwitch } from '@/components/stats/range-switch'
import { TopReels } from '@/components/stats/top-reels'
import { listReels } from '@/db/queries/list-reels'
import { statsOverview } from '@/db/queries/stats-overview'
import { statsPostingTime } from '@/db/queries/stats-posting-time'
import { statsTimeseries, type TimeseriesRange } from '@/db/queries/stats-timeseries'
import { requireSession } from '@/lib/auth/require-session'
import { toPostingHeatmap, toViewsSeries } from '@/lib/stats/chart-data'
import { plural } from '@/lib/format/plural'

/** Белый список: значение из URL уходит в запрос и в ключ Record. */
const RANGES: TimeseriesRange[] = ['7d', '30d', 'all']

/**
 * Порог честности гистограммы.
 *
 * На двух рилсах «лучшее время постить» — это не вывод, а два случая.
 * Нарисовать по ним тепловую карту значит выдать шум за аналитику, а это
 * ровно тот сорт вранья, который проверяющий из индустрии видит сразу.
 * Ниже порога показываем текст, а не картинку.
 */
const MIN_REELS_FOR_HEATMAP = 5

export const metadata: Metadata = { title: 'Дашборд' }

/**
 * Дашборд кабинета.
 *
 * Четыре запроса идут через `Promise.all`, а не по очереди. На free tier Neon
 * засыпает после простоя, и четыре последовательных круга дали бы четыре
 * задержки пробуждения вместо одной — на холодном старте это разница в секунды.
 *
 * Запросы зовутся НАПРЯМУЮ, без похода в собственные `/api/*`: серверный
 * компонент и так на сервере, и лишний HTTP-хоп добавил бы круг по сети
 * и вторую сериализацию.
 *
 * Топ-3 берётся из того же `listReels`, что кормит ленту, с сортировкой по
 * просмотрам: писать пятый запрос ради трёх карточек незачем.
 */
export default async function DashboardPage({ searchParams }: PageProps<'/app'>) {
  const session = await requireSession()

  const requested = (await searchParams).range
  const range: TimeseriesRange = RANGES.includes(requested as TimeseriesRange)
    ? (requested as TimeseriesRange)
    : '30d'

  const [overview, timeseries, postingTime, byViews] = await Promise.all([
    statsOverview(session.userId),
    statsTimeseries(session.userId, range),
    statsPostingTime(session.userId),
    listReels(session.userId, 'views'),
  ])

  const hasReels = overview.reelsCount > 0

  // Считаем по слотам гистограммы, а не по reelsCount: рилс без даты
  // публикации в неё не попадает, и обещать вывод «по трём рилсам»,
  // когда на карте два, — то же враньё, только мельче.
  const datedReels = postingTime.reduce((sum, slot) => sum + slot.reelsCount, 0)
  const enoughForHeatmap = datedReels >= MIN_REELS_FOR_HEATMAP

  // Серверный компонент вызывается один раз за запрос и не мемоизируется
  // React Compiler. Date.now() здесь и есть лекарство от расхождения разметки,
  // а не его причина — тот же приём, что в ленте.
  // eslint-disable-next-line react-hooks/purity
  const serverNow = Date.now()

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Дашборд</h1>
        <p className="text-sm text-[var(--muted)]">
          {hasReels
            ? 'Как расходятся твои рилсы'
            : 'Добавь первый рилс — и здесь появятся цифры'}
        </p>
      </div>

      <KpiRow overview={overview} />

      {!hasReels && (
        <p className="rounded-[var(--radius)] border border-dashed border-[var(--border)] bg-white/50 px-6 py-10 text-center text-sm text-[var(--muted)]">
          Пока считать нечего.{' '}
          <Link href="/app/reels" className="font-medium text-[var(--accent)] underline">
            Добавь первый рилс
          </Link>{' '}
          — цифры и графики появятся сами.
        </p>
      )}

      <TopReels rows={byViews} now={serverNow} />

      <ChartFrame
        title="Динамика просмотров"
        hint={
          timeseries.length === 1
            ? 'данных пока на один день — линия появится завтра'
            : 'суммарно по всем рилсам'
        }
        empty={timeseries.length === 0}
        emptyText="Данных для графика пока нет. Добавь рилс и загляни через день — точки появятся сами."
        action={<RangeSwitch current={range} />}
      >
        <LazyViewsChart points={toViewsSeries(timeseries)} />
      </ChartFrame>

      <ChartFrame
        title="Когда лучше постить"
        hint={
          enoughForHeatmap
            ? `по ${datedReels} ${plural(datedReels, ['рилсу', 'рилсам', 'рилсам'])}, время московское`
            : 'средние просмотры по времени публикации, МСК'
        }
        empty={postingTime.length === 0}
        emptyText="Пока не из чего считать. Нужно хотя бы несколько рилсов, опубликованных в разное время."
      >
        {enoughForHeatmap ? (
          <PostingTimeChart grid={toPostingHeatmap(postingTime)} />
        ) : (
          <p className="rounded-xl border border-dashed border-[var(--border)] bg-white/50 px-4 py-8 text-center text-sm text-[var(--muted)]">
            Пока мало данных: график строится по {datedReels}{' '}
            {plural(datedReels, ['рилсу', 'рилсам', 'рилсам'])}. Нужно хотя бы{' '}
            {MIN_REELS_FOR_HEATMAP} — иначе это не «лучшее время», а просто
            несколько случаев.
          </p>
        )}
      </ChartFrame>
    </div>
  )
}
