import { eq } from 'drizzle-orm'
import { db, reels, syncRuns } from '@/db'
import { tryReserve } from '@/db/queries/budget'
import { lastAttemptFor, manualAttemptsSince } from '@/db/queries/sync-state'
import { fail, handleError, ok } from '@/lib/api/respond'
import { isMock, startRun } from '@/lib/apify/client'
import { assertOwned } from '@/lib/auth/ownership'
import { requireSession } from '@/lib/auth/require-session'
import { checkUserRate, USER_SYNC_WINDOW_MS } from '@/lib/sync/rate-limit'
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

    // Лимит на человека идёт ПЕРВЫМ: он дешевле часового (один COUNT против
    // выборки с сортировкой) и отсекает разгон по разным рилсам, который
    // часовой троттлинг пропускает по построению.
    const attempts = await manualAttemptsSince(
      session.userId,
      new Date(Date.now() - USER_SYNC_WINDOW_MS),
    )
    const rate = checkUserRate(attempts, new Date())
    if (!rate.allowed) return fail(rate.message, 429)

    // Источник — sync_runs.started_at, а не reels.lastSyncedAt: последнее поле
    // пишет только ingestReel при успехе или unavailable (src/db/queries/ingest.ts).
    // Провалившийся прогон lastSyncedAt не трогает, а кредит Apify уже потрачен —
    // троттлить по lastSyncedAt значило бы никогда не троттлить кнопку «Повторить»
    // у рилсов в failed. Не «упрощать» обратно на reel.lastSyncedAt.
    //
    // Ключ — ПАРА (user_id, shortcode), а не reel_id. Разница видна ровно
    // в одном сценарии, и он же был дырой: удалить рилс и вставить ту же
    // ссылку заново. Новый reel_id не помнил ничего, пара помнит.
    const lastAttempt = await lastAttemptFor(session.userId, reel.shortcode)

    const verdict = checkManualSync(lastAttempt, new Date())
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

    // Строка sync_runs пишется ДО startRun, а не после. Троттлинг выше читает
    // MAX(sync_runs.started_at) как время последней ПОПЫТКИ — если startRun
    // бросит исключение (Apify недоступен, токен отозван), обратный порядок
    // оставил бы попытку незарегистрированной: кредит уже списан tryReserve,
    // клиент откатит карточку в ok, и следующий клик снова пройдёт троттлинг
    // и снова спишет кредит — без счётчика между ними вообще нет.
    const [pendingRun] = await db
      .insert(syncRuns)
      .values({
        reelId: reel.id,
        userId: session.userId,
        shortcode: reel.shortcode,
        triggeredBy: 'manual',
        apifyRunId: null,
        status: 'running',
      })
      .returning({ id: syncRuns.id })

    let run
    try {
      run = await startRun([reel.url])
    } catch (error) {
      await db
        .update(syncRuns)
        .set({
          status: 'failed',
          error: 'Не получилось запустить прогон Apify',
          finishedAt: new Date(),
        })
        .where(eq(syncRuns.id, pendingRun.id))
      throw error
    }

    await db
      .update(syncRuns)
      .set({
        apifyRunId: run.runId,
        status: run.status === 'FAILED' ? 'failed' : 'running',
      })
      .where(eq(syncRuns.id, pendingRun.id))

    await db
      .update(reels)
      .set({ syncStatus: 'pending', syncError: null })
      .where(eq(reels.id, reel.id))

    return ok({ id: reel.id, syncStatus: 'pending' }, 202)
  } catch (error) {
    return handleError(error)
  }
}
