/**
 * Приведение элемента датасета apify/instagram-scraper к нашей форме.
 *
 * Схема ответа у актора со временем меняется, а часть полей приходит null
 * в зависимости от настроек приватности автора. Поэтому здесь ничего не
 * предполагается: каждое поле проверяется, недостоверное становится null.
 */

export type ReelData = {
  shortcode: string
  caption: string | null
  ownerUsername: string | null
  postedAt: Date | null
  durationSec: number | null
  thumbnailSrc: string | null
  isReel: boolean
  views: number | null
  plays: number | null
  likes: number | null
  comments: number | null
}

/**
 * Instagram отдаёт -1, когда автор скрыл счётчик лайков.
 * Ноль при этом — валидное значение, путать их нельзя: «0 лайков»
 * и «лайки скрыты» в интерфейсе выглядят по-разному.
 */
function toCount(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null
  return Math.trunc(value)
}

function toText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function toDate(value: unknown): Date | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

export function normalizeApifyItem(item: unknown): ReelData | null {
  if (!item || typeof item !== 'object') return null
  const raw = item as Record<string, unknown>

  // Без shortcode запись бесполезна: по нему идёт дедуп и построение ссылки.
  const shortcode = toText(raw.shortCode)
  if (!shortcode) return null

  const plays = toCount(raw.videoPlayCount)
  const views = toCount(raw.videoViewCount)

  return {
    shortcode,
    caption: toText(raw.caption),
    ownerUsername: toText(raw.ownerUsername),
    postedAt: toDate(raw.timestamp),
    durationSec:
      typeof raw.videoDuration === 'number' && Number.isFinite(raw.videoDuration)
        ? raw.videoDuration
        : null,
    thumbnailSrc: toText(raw.displayUrl),
    isReel: raw.productType === 'clips',
    // videoPlayCount и videoViewCount — РАЗНЫЕ метрики, и одна часто отсутствует.
    // plays («сколько раз запустили») точнее отражает охват рилса, поэтому он первый.
    views: plays ?? views,
    plays,
    likes: toCount(raw.likesCount),
    comments: toCount(raw.commentsCount),
  }
}
