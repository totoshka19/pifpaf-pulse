import { NextResponse } from 'next/server'

/**
 * Единый формат ответов API.
 *
 * Ошибки распознаются ПО КОНТРАКТУ, а не по классу: если на объекте есть числовой
 * `status` в диапазоне 4xx — значит ошибку пометили мы сами, её текст написан
 * для человека и его можно отдавать наружу.
 *
 * Проверка через `instanceof` потянула бы сюда импорт `require-session.ts`,
 * а с ним `next/headers` — и хелпер форматирования оказался бы завязан на рантайм
 * Next и непроверяемым вне запроса.
 */

export function ok<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(data, { status })
}

export function fail(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status })
}

/** Код ответа, если ошибка помечена нами. Иначе null. */
function clientStatusOf(error: unknown): number | null {
  if (!error || typeof error !== 'object' || !('status' in error)) return null

  const status = (error as { status: unknown }).status

  // Только 4xx: 5xx и всё остальное могло прийти из чужой библиотеки,
  // и доверять такому коду — значит отдать наружу её внутренности.
  return typeof status === 'number' && status >= 400 && status < 500 ? status : null
}

export function handleError(error: unknown): NextResponse {
  const status = clientStatusOf(error)

  if (status !== null) {
    const message = error instanceof Error ? error.message : 'Не получилось'
    return fail(message, status)
  }

  // Всё непомеченное — наша внутренняя проблема. Наружу текст не отдаём:
  // в сообщении драйвера Postgres может оказаться строка подключения с паролем.
  console.error('[api]', error)
  return fail('Что-то пошло не так с нашей стороны. Попробуй ещё раз', 500)
}
