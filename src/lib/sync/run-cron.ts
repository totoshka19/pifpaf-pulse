import { and, eq, inArray, isNotNull } from 'drizzle-orm'
import { db, reels, syncRuns } from '@/db'
import { ingestReel } from '@/db/queries/ingest'
import { getDatasetItems, getRun } from '@/lib/apify/client'

/**
 * Фоновая синхронизация. Две фазы одного тика, обе ничего не ждут.
 *
 * Ждать завершения прогона внутри одного вызова нельзя: Netlify обрывает
 * функцию через 10 секунд, а прогон Apify идёт 14–19 (замер среза 3).
 * Поэтому тик забирает результаты прогонов, запущенных ПРОШЛЫМ тиком,
 * и стартует новые для следующего.
 */

/**
 * Прогон, висящий дольше этого, считается мёртвым.
 *
 * Шесть часов с запасом больше и самого прогона (19 с), и самой частой
 * ступени расписания (1 ч): живой прогон под этот порог не попадёт никогда.
 * Без порога зависший прогон блокирует свои рилсы навсегда — они остаются
 * в `pending`, а `next_sync_at` у них в будущем.
 */
export const STUCK_RUN_MS = 6 * 3_600_000

/**
 * Фаза 1: забрать результаты завершённых прогонов.
 *
 * Строки группируются по `apify_run_id`, потому что один прогон покрывает
 * весь батч: спрашивать статус и тянуть датасет по разу на каждый рилс
 * значило бы сделать десять одинаковых запросов вместо одного.
 *
 * Возвращает число рилсов, по которым данные приняты.
 */
export async function collectFinishedRuns(now = new Date()): Promise<number> {
  const running = await db
    .select({
      id: syncRuns.id,
      reelId: syncRuns.reelId,
      apifyRunId: syncRuns.apifyRunId,
      startedAt: syncRuns.startedAt,
    })
    .from(syncRuns)
    .where(and(eq(syncRuns.status, 'running'), isNotNull(syncRuns.apifyRunId)))

  const byRun = new Map<string, typeof running>()
  for (const row of running) {
    const key = row.apifyRunId!
    const bucket = byRun.get(key)
    if (bucket) bucket.push(row)
    else byRun.set(key, [row])
  }

  let collected = 0

  for (const [apifyRunId, rows] of byRun) {
    const ids = rows.map((r) => r.id)
    const oldest = Math.min(...rows.map((r) => r.startedAt.getTime()))

    if (now.getTime() - oldest > STUCK_RUN_MS) {
      await failRuns(ids, 'Прогон не завершился за отведённое время', now)
      continue
    }

    let handle
    try {
      handle = await getRun(apifyRunId)
    } catch {
      // Apify недоступен — не трогаем ничего, следующий тик повторит.
      continue
    }

    if (handle.status === 'RUNNING') continue

    if (handle.status === 'FAILED' || !handle.datasetId) {
      await failRuns(ids, 'Прогон Apify завершился ошибкой', now)
      continue
    }

    const items = await getDatasetItems(handle.datasetId)

    for (const row of rows) {
      // reel_id стал NULL — рилс удалили, пока прогон шёл. Принимать данные
      // некуда, но прогон всё равно надо закрыть.
      if (!row.reelId) continue

      try {
        await ingestReel(row.reelId, items, now)
        collected++
      } catch {
        // Один битый рилс не должен ронять весь батч: остальные девять
        // уже оплачены и их данные лежат в этом же датасете.
      }
    }

    await db
      .update(syncRuns)
      .set({ status: 'succeeded', finishedAt: now })
      .where(inArray(syncRuns.id, ids))
  }

  return collected
}

async function failRuns(ids: number[], error: string, now: Date): Promise<void> {
  await db
    .update(syncRuns)
    .set({ status: 'failed', error, finishedAt: now })
    .where(inArray(syncRuns.id, ids))

  // Рилсы этих прогонов остаются в pending без надежды продвинуться.
  // Переводим в failed, чтобы их забрал существующий путь «Повторить».
  const rows = await db
    .select({ reelId: syncRuns.reelId })
    .from(syncRuns)
    .where(inArray(syncRuns.id, ids))

  const reelIds = rows.map((r) => r.reelId).filter((id): id is string => id !== null)
  if (reelIds.length === 0) return

  await db
    .update(reels)
    .set({
      syncStatus: 'failed',
      syncError: 'Не получилось забрать данные. Попробуй обновить рилс ещё раз',
    })
    .where(inArray(reels.id, reelIds))
}
