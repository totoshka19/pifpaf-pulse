/**
 * Разбор ссылки на рилс из Instagram.
 *
 * Блогер копирует ссылку с телефона, поэтому форм у неё много: /reel/, /reels/,
 * /p/, /tv/, с именем автора в пути, с хвостом ?igsh= от кнопки «Поделиться».
 * Полный перечень поддерживаемых форм — в PLAN.md §5 и в тестах рядом.
 */

export type NormalizeResult =
  | { ok: true; shortcode: string; canonicalUrl: string }
  | { ok: false; reason: string }

/** Сегменты пути, сразу после которых идёт shortcode медиа. */
const MEDIA_SEGMENTS = new Set(['reel', 'reels', 'p', 'tv'])

/** Instagram выдаёт shortcode в base64url-алфавите. */
const SHORTCODE_RE = /^[A-Za-z0-9_-]{5,20}$/

/** Хосты Instagram. Сравнение точное: instagram.com.evil.ru — не Instagram. */
const HOSTS = new Set(['instagram.com', 'instagr.am'])

export function normalizeReelUrl(input: string): NormalizeResult {
  const raw = (input ?? '').trim()
  if (!raw) {
    return { ok: false, reason: 'Вставь ссылку на рилс' }
  }

  let url: URL
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
  } catch {
    return { ok: false, reason: 'Это не похоже на ссылку' }
  }

  const host = url.hostname.toLowerCase().replace(/^(www|m)\./, '')
  if (!HOSTS.has(host)) {
    return { ok: false, reason: 'Нужна ссылка с instagram.com' }
  }

  const segments = url.pathname.split('/').filter(Boolean)
  const mediaIndex = segments.findIndex((segment) =>
    MEDIA_SEGMENTS.has(segment.toLowerCase()),
  )
  if (mediaIndex === -1) {
    return { ok: false, reason: 'Это ссылка на Instagram, но не на рилс или пост' }
  }

  const shortcode = segments[mediaIndex + 1]
  if (!shortcode) {
    return { ok: false, reason: 'В ссылке нет кода рилса — скопируй её целиком' }
  }
  if (!SHORTCODE_RE.test(shortcode)) {
    return { ok: false, reason: 'Код рилса в ссылке выглядит странно — проверь её' }
  }

  return {
    ok: true,
    shortcode,
    canonicalUrl: `https://www.instagram.com/reel/${shortcode}/`,
  }
}
