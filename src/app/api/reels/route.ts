import { and, eq } from 'drizzle-orm'
import { db, reels, syncRuns } from '@/db'
import { tryReserve } from '@/db/queries/budget'
import { listReels, type ReelSort } from '@/db/queries/list-reels'
import { fail, handleError, ok } from '@/lib/api/respond'
import { isMock, startRun } from '@/lib/apify/client'
import { requireSession } from '@/lib/auth/require-session'
import { normalizeReelUrl } from '@/lib/instagram/normalize-url'

export const runtime = 'nodejs'

const SORTS: ReelSort[] = ['date', 'views', 'added', 'growth']

/** Лента своих рилсов. */
export async function GET(request: Request) {
  try {
    const session = await requireSession()

    // Белый список: подстановка значения прямо в ORDER BY — это SQL-инъекция.
    const requested = new URL(request.url).searchParams.get('sort')
    const sort = SORTS.includes(requested as ReelSort) ? (requested as ReelSort) : 'added'

    return ok({ reels: await listReels(session.userId, sort) })
  } catch (error) {
    return handleError(error)
  }
}

/**
 * Приём ссылки на рилс.
 *
 * Отвечает 202 и НЕ ждёт Apify: прогон идёт 30–60 секунд, а функция на Netlify
 * обрывается через 10 (PLAN.md §1). Данные подтянет `GET /api/reels/:id`,
 * который фронт опрашивает раз в пару секунд.
 */
export async function POST(request: Request) {
  try {
    const session = await requireSession()
    const body = await request.json().catch(() => null)

    const parsed = normalizeReelUrl(typeof body?.url === 'string' ? body.url : '')
    if (!parsed.ok) return fail(parsed.reason, 400)

    // Дедуп: тот же рилс у того же блогера добавляется один раз.
    const [existing] = await db
      .select({ id: reels.id })
      .from(reels)
      .where(and(eq(reels.userId, session.userId), eq(reels.shortcode, parsed.shortcode)))

    if (existing) {
      // Отдаём id, чтобы интерфейс мог подсветить уже существующую карточку.
      return ok({ id: existing.id, duplicate: true, error: 'Этот рилс уже добавлен' }, 409)
    }

    // Бюджет резервируется ДО запуска прогона. Обратный порядок означает,
    // что при исчерпанном лимите кредиты уже потрачены, а узнаём мы после.
    //
    // В режиме мока счётчик НЕ трогаем: данные приходят из фикстур, из тарифа
    // Apify не расходуется ничего. Иначе разработка за несколько дней «выбрала»
    // бы месячный лимит, и предохранитель отказал бы в синхронизации настоящих
    // рилсов на проде — вызвав ровно ту аварию, от которой оберегает.
    if (!isMock() && !(await tryReserve(1))) {
      return fail(
        'Лимит обновлений на этот месяц исчерпан. Уже добавленные рилсы продолжают показываться',
        429,
      )
    }

    const [reel] = await db
      .insert(reels)
      .values({
        userId: session.userId,
        shortcode: parsed.shortcode,
        url: parsed.canonicalUrl,
        syncStatus: 'pending',
      })
      .returning({ id: reels.id, shortcode: reels.shortcode })

    // Строка sync_runs пишется ДО startRun — тот же порядок и та же причина,
    // что в POST /api/reels/:id/sync: если startRun бросит исключение, рилс
    // не должен остаться осиротевшим в pending без единой строки в sync_runs.
    // Без неё advanceIfPending не может отличить «прогон ещё идёт» от «прогона
    // не было и не будет» и никогда не предложит «Повторить».
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
      run = await startRun([parsed.canonicalUrl])
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

    return ok({ id: reel.id, shortcode: reel.shortcode, syncStatus: 'pending' }, 202)
  } catch (error) {
    return handleError(error)
  }
}
