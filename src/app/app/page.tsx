import type { Metadata } from 'next'
import Link from 'next/link'
import { ChartFrame } from '@/components/stats/chart-frame'
import { KpiRow } from '@/components/stats/kpi-row'
import { TopReels } from '@/components/stats/top-reels'
import { listReels } from '@/db/queries/list-reels'
import { statsOverview } from '@/db/queries/stats-overview'
import { statsPostingTime } from '@/db/queries/stats-posting-time'
import { statsTimeseries } from '@/db/queries/stats-timeseries'
import { requireSession } from '@/lib/auth/require-session'

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
export default async function DashboardPage() {
  const session = await requireSession()

  const [overview, timeseries, postingTime, byViews] = await Promise.all([
    statsOverview(session.userId),
    statsTimeseries(session.userId, '30d'),
    statsPostingTime(session.userId),
    listReels(session.userId, 'views'),
  ])

  const hasReels = overview.reelsCount > 0

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

      {/* Графики приезжают задачами 8 и 9 среза 6. */}
      <ChartFrame
        title="Динамика просмотров"
        hint="суммарно по всем рилсам, за 30 дней"
        empty={timeseries.length === 0}
        emptyText="Данных для графика пока нет. Добавь рилс и загляни через день — точки появятся сами."
      >
        <p className="text-sm text-[var(--muted)]">{timeseries.length} точек</p>
      </ChartFrame>

      <ChartFrame
        title="Когда лучше постить"
        hint="средние просмотры по времени публикации, МСК"
        empty={postingTime.length === 0}
        emptyText="Пока не из чего считать. Нужно хотя бы несколько рилсов, опубликованных в разное время."
      >
        <p className="text-sm text-[var(--muted)]">{postingTime.length} слотов</p>
      </ChartFrame>
    </div>
  )
}
