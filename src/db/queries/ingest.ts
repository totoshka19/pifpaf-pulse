import { desc, eq } from 'drizzle-orm'
import { db, reels, reelSnapshots } from '@/db'
import { normalizeApifyItem } from '@/lib/instagram/normalize-item'
import { computeNextSyncAt } from '@/lib/sync/schedule'

export type IngestResult = {
  status: 'ok' | 'unavailable'
  snapshotWritten: boolean
}

/**
 * Записывает результат прогона Apify для одного рилса.
 *
 * Два правила, без которых история метрик разваливается (PLAN.md §3):
 *
 *  1. `lastSyncedAt` обновляется ВСЕГДА — это доказательство свежести данных,
 *     и именно оно, а не дублирующая строка в истории, отвечает на вопрос
 *     «когда последний раз проверяли».
 *
 *  2. Строка в `reel_snapshots` пишется ТОЛЬКО если метрики изменились. Иначе
 *     при опросе раз в час график роста превращается в лестницу из одинаковых
 *     точек, а таблица растёт на сотни строк в сутки без новой информации.
 */
export async function ingestReel(
  reelId: string,
  items: unknown[],
  now = new Date(),
): Promise<IngestResult> {
  const [reel] = await db.select().from(reels).where(eq(reels.id, reelId))
  if (!reel) throw new Error(`Рилс ${reelId} не найден`)

  // Сопоставление строго по shortcode: батч возвращает элементы вперемешку,
  // и брать первый попавшийся значит записать рилсу чужие метрики.
  const data = items
    .map(normalizeApifyItem)
    .find((item) => item?.shortcode === reel.shortcode)

  if (!data) {
    // Пустой датасет — штатный ответ Apify на приватную или удалённую запись.
    await db
      .update(reels)
      .set({
        syncStatus: 'unavailable',
        syncError: 'Рилс недоступен: аккаунт закрыт или запись удалена',
        lastSyncedAt: now,
        // Снимаем с расписания: частичный индекс idx_reels_due исключает
        // такие записи, и крон перестанет их опрашивать.
        nextSyncAt: null,
      })
      .where(eq(reels.id, reelId))

    return { status: 'unavailable', snapshotWritten: false }
  }

  await db
    .update(reels)
    .set({
      caption: data.caption,
      ownerUsername: data.ownerUsername,
      thumbnailSrc: data.thumbnailSrc,
      postedAt: data.postedAt,
      // numeric в Drizzle принимает строку: число потеряло бы точность
      // на длинных дробных значениях вроде 10.377869.
      durationSec: data.durationSec === null ? null : String(data.durationSec),
      syncStatus: 'ok',
      syncError: null,
      lastSyncedAt: now,
      nextSyncAt: computeNextSyncAt(data.postedAt, now),
    })
    .where(eq(reels.id, reelId))

  const [last] = await db
    .select()
    .from(reelSnapshots)
    .where(eq(reelSnapshots.reelId, reelId))
    .orderBy(desc(reelSnapshots.capturedAt))
    .limit(1)

  const unchanged =
    last !== undefined &&
    last.views === data.views &&
    last.plays === data.plays &&
    last.likes === data.likes &&
    last.comments === data.comments

  if (unchanged) return { status: 'ok', snapshotWritten: false }

  await db.insert(reelSnapshots).values({
    reelId,
    views: data.views,
    plays: data.plays,
    likes: data.likes,
    comments: data.comments,
    capturedAt: now,
  })

  return { status: 'ok', snapshotWritten: true }
}
