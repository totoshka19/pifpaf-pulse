/**
 * Проверка полей личного кабинета.
 *
 * Структура ответа и тон сообщений — те же, что в
 * `src/lib/instagram/normalize-url.ts`: интерфейс должен говорить одним
 * голосом, а не двумя разными в зависимости от того, какое поле заполняют.
 */

export const MAX_DISPLAY_NAME = 60

/** Instagram: буквы, цифры, точка и подчёркивание, длина 1–30. */
const HANDLE_RE = /^[a-z0-9._]{1,30}$/
const MAX_HANDLE = 30

/** Хосты Instagram. Сравнение точное: instagram.com.evil.ru — не Instagram. */
const HOSTS = new Set(['instagram.com', 'instagr.am'])

/**
 * Сегменты, после которых в пути идёт медиа, а не имя пользователя.
 * Ссылка на рилс — не хендл, и молча взять из неё «reel» было бы хуже отказа.
 */
const NOT_A_HANDLE = new Set(['reel', 'reels', 'p', 'tv', 'explore', 'stories', 'accounts'])

export type HandleResult = { ok: true; handle: string | null } | { ok: false; reason: string }

/** Текст ошибки для интерфейса или `null`, если имя годится. */
export function validateDisplayName(raw: string): string | null {
  const name = (raw ?? '').trim()

  if (!name) return 'Как тебя зовут?'
  if (name.length > MAX_DISPLAY_NAME) {
    return `Имя длиннее ${MAX_DISPLAY_NAME} символов — сократи его`
  }

  return null
}

/**
 * `@name`, `instagram.com/name/`, `name` → `name`.
 *
 * Пустое значение — ВАЛИДНО: поле необязательное, и `ok: true` с `handle: null`
 * это не ошибка. Правило «нет данных — не ошибка» действует и здесь.
 *
 * Регистр не значим: `@Anya` и `@anya` — один человек, и хранить их как два
 * разных хендла значит однажды не найти совпадение.
 */
export function normalizeInstagramHandle(raw: string): HandleResult {
  const input = (raw ?? '').trim()

  // Пустое поле и одинокая собачка — просто «не указано».
  if (!input || input === '@') return { ok: true, handle: null }

  // Похоже на ссылку — разбираем как ссылку.
  if (input.includes('/') || /^https?:/i.test(input)) {
    return fromUrl(input)
  }

  return fromBareHandle(input.replace(/^@/, ''))
}

function fromUrl(input: string): HandleResult {
  let url: URL
  try {
    url = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`)
  } catch {
    return { ok: false, reason: 'Это не похоже ни на имя, ни на ссылку' }
  }

  const host = url.hostname.toLowerCase().replace(/^(www|m)\./, '')
  if (!HOSTS.has(host)) {
    return { ok: false, reason: 'Нужно имя из Instagram или ссылка на профиль там' }
  }

  const segments = url.pathname.split('/').filter(Boolean)
  const first = segments[0]?.toLowerCase()

  if (!first) {
    return { ok: false, reason: 'В ссылке нет имени профиля — скопируй её целиком' }
  }
  if (NOT_A_HANDLE.has(first)) {
    return { ok: false, reason: 'Это ссылка на публикацию, а не на профиль' }
  }

  return fromBareHandle(first.replace(/^@/, ''))
}

function fromBareHandle(candidate: string): HandleResult {
  const handle = candidate.toLowerCase()

  if (!handle) return { ok: true, handle: null }

  // Длину проверяем ОТДЕЛЬНО от формы: «слишком длинно» и «недопустимый
  // символ» — разные проблемы, и общая формулировка не подсказала бы, что чинить.
  if (handle.length > MAX_HANDLE) {
    return { ok: false, reason: `Имя в Instagram не бывает длиннее ${MAX_HANDLE} символов` }
  }

  if (!HANDLE_RE.test(handle)) {
    return {
      ok: false,
      reason: 'В имени Instagram бывают только латинские буквы, цифры, точка и подчёркивание',
    }
  }

  return { ok: true, handle }
}
