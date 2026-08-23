import { cookies } from 'next/headers'
import { SESSION_COOKIE } from './cookie'
import { verifySession, type Session } from './session'

/**
 * Чтение сессии внутри серверных компонентов и route handlers.
 *
 * `proxy.ts` уже отсекает гостей от `/app/*`, но полагаться только на него
 * нельзя: эндпоинты `/api/*` под матчер не попадают, а данные отдают именно они.
 * Каждый эндпоинт с данными обязан звать `requireSession` сам.
 */

export class UnauthorizedError extends Error {
  readonly status = 401

  constructor() {
    super('Нужно войти')
    this.name = 'UnauthorizedError'
  }
}

/** Сессия или null. Для мест, где гость — нормальный случай. */
export async function getSession(): Promise<Session | null> {
  // В Next 15+ cookies() асинхронный.
  const store = await cookies()
  return verifySession(store.get(SESSION_COOKIE)?.value)
}

/** Сессия или исключение с кодом 401. */
export async function requireSession(): Promise<Session> {
  const session = await getSession()
  if (!session) throw new UnauthorizedError()
  return session
}
