import { eq } from 'drizzle-orm'
import { db, reels, syncRuns } from '@/db'
import { tryReserve } from '@/db/queries/budget'
import { fail, handleError, ok } from '@/lib/api/respond'
import { isMock, startRun } from '@/lib/apify/client'
import { assertOwned } from '@/lib/auth/ownership'
import { requireSession } from '@/lib/auth/require-session'
import { checkManualSync } from '@/lib/sync/throttle'

export const runtime = 'nodejs'

/**
 * Ручное обновление одного рилса.
 *
 * Четвёртый вызывающий уже существующего конвейера: резерв бюджета → запуск
 * прогона → продвижение статуса в `GET /api/reels/:id`. Ждать завершения здесь
 * нельзя — функция на Netlify обрывается через 10 секунд, а прогон идёт 14–19.
 *
 * Статус переводится в `pending`, но метрики при этом НЕ пропадают: они лежат
 * в `reel_snapshots`, и лента продолжит показывать последний снапшот.
 */
export async function POST(
  _request: Request,
  { params }: RouteContext<'/api/reels/[id]/sync'>,
) {
  try {
    const session = await requireSession()
    const { id } = await params

    const [found] = await db.select().from(reels).where(eq(reels.id, id))

    // Проверка владения ДО любых действий: обратный порядок позволил бы чужому
    // пользователю тратить наши кредиты Apify на чужой записи.
    const reel = assertOwned(found, session)

    const verdict = checkManualSync(reel.lastSyncedAt, new Date())
    if (!verdict.allowed) return fail(verdict.message, 429)

    // Бюджет резервируется ДО запуска. Обратный порядок означает, что при
    // исчерпанном лимите кредиты уже потрачены, а узнаём мы после.
    // В режиме мока счётчик не трогаем: из тарифа Apify не расходуется ничего.
    if (!isMock() && !(await tryReserve(1))) {
      return fail(
        'Лимит обновлений на этот месяц исчерпан. Уже добавленные рилсы продолжают показываться',
        429,
      )
    }

    const run = await startRun([reel.url])

    await db.insert(syncRuns).values({
      reelId: reel.id,
      apifyRunId: run.runId,
      status: run.status === 'FAILED' ? 'failed' : 'running',
    })

    await db
      .update(reels)
      .set({ syncStatus: 'pending', syncError: null })
      .where(eq(reels.id, reel.id))

    return ok({ id: reel.id, syncStatus: 'pending' }, 202)
  } catch (error) {
    return handleError(error)
  }
}
