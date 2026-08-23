import { eq } from 'drizzle-orm'
import { db, reels, reelThumbnails } from '@/db'
import { fetchImage } from '@/lib/images/fetch'
import { processThumbnail } from '@/lib/images/process'

export type EnsureResult = 'stored' | 'exists' | 'skipped'

/**
 * Скачивает обложку рилса и кладёт к себе.
 *
 * Вынесено ИЗ `ingestReel` намеренно. Скачивание занимает 0,5–1,8 с (замерено),
 * и внутри батча из среза 7 двадцать обложек не влезут в десятисекундный лимит
 * функции Netlify. Вызывающий сам решает, сколько картинок себе позволить:
 * карточка берёт одну, крон — сколько успеет, скрипт дозаливки — с паузами.
 *
 * НИКОГДА не бросает. Метрики важнее картинки: провал скачивания не должен
 * ронять приём данных, а ссылки Instagram протухают за ~4,5 суток, так что
 * мёртвая ссылка — штатная ситуация, а не сбой.
 */
export async function ensureThumbnail(reelId: string): Promise<EnsureResult> {
  const [existing] = await db
    .select({ reelId: reelThumbnails.reelId })
    .from(reelThumbnails)
    .where(eq(reelThumbnails.reelId, reelId))

  if (existing) return 'exists'

  const [reel] = await db
    .select({ src: reels.thumbnailSrc })
    .from(reels)
    .where(eq(reels.id, reelId))

  if (!reel?.src) return 'skipped'

  const raw = await fetchImage(reel.src)
  if (!raw) return 'skipped'

  const image = await processThumbnail(raw)
  if (!image) return 'skipped'

  await db
    .insert(reelThumbnails)
    .values({
      reelId,
      data: image.data,
      mime: image.mime,
      width: image.width,
      height: image.height,
      bytes: image.bytes,
    })
    // Гонка двух параллельных вызовов — не ошибка: кто успел, того и картинка.
    .onConflictDoNothing()

  return 'stored'
}

export async function readThumbnail(reelId: string) {
  const [row] = await db
    .select({ data: reelThumbnails.data, mime: reelThumbnails.mime })
    .from(reelThumbnails)
    .where(eq(reelThumbnails.reelId, reelId))

  return row ?? null
}
