import type { Metadata } from 'next'
import { ChartFrame } from '@/components/stats/chart-frame'
import { statsOverview } from '@/db/queries/stats-overview'
import { statsPostingTime } from '@/db/queries/stats-posting-time'
import { statsTimeseries } from '@/db/queries/stats-timeseries'
import { requireSession } from '@/lib/auth/require-session'

export const metadata: Metadata = { title: 'Дашборд' }

/**
 * Дашборд кабинета.
 *
 * Три запроса идут через `Promise.all`, а не по очереди. На free tier Neon
 * засыпает после простоя, и три последовательных круга дали бы три задержки
 * пробуждения вместо одной — на холодном старте это разница в секунды.
 *
 * Запросы зовутся НАПРЯМУЮ, без похода в собственные `/api/*`: серверный
 * компонент и так на сервере, и лишний HTTP-хоп добавил бы круг по сети
 * и вторую сериализацию.
 */
export default async function DashboardPage() {
  const session = await requireSession()

  const [overview, timeseries, postingTime] = await Promise.all([
    statsOverview(session.userId),
    statsTimeseries(session.userId, '30d'),
    statsPostingTime(session.userId),
  ])

  const hasReels = overview.reelsCount > 0

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

      {/* Наполнение приезжает задачами 7–9 среза 6. */}
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
