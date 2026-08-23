import { asc, desc, eq } from 'drizzle-orm'
import { db, reels, reelSnapshots, syncRuns } from '@/db'
import { ingestReel } from '@/db/queries/ingest'
import { ensureThumbnail } from '@/db/queries/thumbnails'
import { handleError, ok } from '@/lib/api/respond'
import { getDatasetItems, getRun } from '@/lib/apify/client'
import { assertOwned } from '@/lib/auth/ownership'
import { requireSession } from '@/lib/auth/require-session'

export const runtime = 'nodejs'

/**
 * Продвигает рилс из `pending`, если прогон Apify успел завершиться.
 *
 * ЖДАТЬ ЗАВЕРШЕНИЯ ЗДЕСЬ НЕЛЬЗЯ: функция на Netlify обрывается через 10 секунд,
 * а прогон идёт 30–60 (PLAN.md §1). Один вызов — одна проверка статуса.
 * Ждёт фронт, опрашивая этот эндпоинт раз в 2–3 секунды.
 */
async function advanceIfPending(reelId: string): Promise<void> {
  const [run] = await db
    .select()
    .from(syncRuns)
    .where(eq(syncRuns.reelId, reelId))
    .orderBy(desc(syncRuns.startedAt))
    .limit(1)

  if (!run?.apifyRunId || run.status !== 'running') return

  let handle
  try {
    handle = await getRun(run.apifyRunId)
  } catch {
    // Apify недоступен — не роняем карточку. Рилс останется в pending
    // и будет подхвачен следующим опросом или кроном из среза 7.
    return
  }

  if (handle.status === 'RUNNING') return

  if (handle.status === 'FAILED' || !handle.datasetId) {
    await db
      .update(syncRuns)
      .set({
        status: 'failed',
        error: 'Прогон Apify завершился ошибкой',
        finishedAt: new Date(),
      })
      .where(eq(syncRuns.id, run.id))

    await db
      .update(reels)
      .set({
        syncStatus: 'failed',
        syncError: 'Не получилось забрать данные. Попробуй обновить рилс ещё раз',
      })
      .where(eq(reels.id, reelId))

    return
  }

  const items = await getDatasetItems(handle.datasetId)
  await ingestReel(reelId, items)

  await db
    .update(syncRuns)
    .set({ status: 'succeeded', finishedAt: new Date() })
    .where(eq(syncRuns.id, run.id))

  // Обложка — не критичный путь: метрики уже записаны, статус уже `ok`.
  // Ошибку глотаем: ссылки Instagram протухают, и терять цифры из-за мёртвой
  // картинки — плохой обмен. Если не вышло, попробуем на следующем заходе.
  await ensureThumbnail(reelId).catch(() => {})
}

export async function GET(_request: Request, { params }: RouteContext<'/api/reels/[id]'>) {
  try {
    const session = await requireSession()
    const { id } = await params

    const [found] = await db.select().from(reels).where(eq(reels.id, id))

    // Проверка владения ДО любых действий. Обратный порядок позволил бы чужому
    // пользователю тратить наши кредиты Apify на чужой записи — и узнать о её
    // существовании по времени ответа.
    const reel = assertOwned(found, session)

    if (reel.syncStatus === 'pending') {
      await advanceIfPending(reel.id)
    }

    // Перечитываем: advanceIfPending мог поменять статус и метрики.
    const [fresh] = await db.select().from(reels).where(eq(reels.id, id))

    const snapshots = await db
      .select()
      .from(reelSnapshots)
      .where(eq(reelSnapshots.reelId, id))
      .orderBy(asc(reelSnapshots.capturedAt))

    return ok({ reel: fresh, snapshots })
  } catch (error) {
    return handleError(error)
  }
}

export async function DELETE(
  _request: Request,
  { params }: RouteContext<'/api/reels/[id]'>,
) {
  try {
    const session = await requireSession()
    const { id } = await params

    const [found] = await db.select().from(reels).where(eq(reels.id, id))
    assertOwned(found, session)

    // Снапшоты, обложки и прогоны уйдут каскадом: внешние ключи объявлены
    // с ON DELETE CASCADE в схеме.
    await db.delete(reels).where(eq(reels.id, id))

    return ok({ ok: true })
  } catch (error) {
    return handleError(error)
  }
}
