import { eq } from 'drizzle-orm'
import { db, users } from '@/db'
import { getSession } from './require-session'
import type { Role } from './session'

/**
 * ЕДИНСТВЕННОЕ определение «сессия жива»: подпись токена цела И пользователь
 * всё ещё есть в базе.
 *
 * Зачем отдельный модуль. Токен подписан на 30 дней и нигде на сервере не
 * хранится — отозвать его нечем, и он спокойно переживает своего владельца.
 * Пока каждый экран решал сам, что считать входом, определения разъехались:
 * `/login` верил одной подписи и отправлял «уже вошедшего» в `/app`, а
 * оболочка `/app` требовала ещё и строку в `users` и отправляла обратно на
 * `/login`. Токен без пользователя запускал эти два редиректа по кругу до
 * отказа браузера, и выбраться было нельзя: форма входа недостижима, а выход
 * висит на POST, который адресной строкой не позвать.
 *
 * Разъехаться снова они теперь не могут: определение здесь одно на обоих.
 *
 * Почему не в `require-session.ts`: тот модуль обязан оставаться без базы —
 * его же типы читает `src/proxy.ts`, которому по документации положено быть
 * автономным. Запрос к базе живёт здесь, а не там.
 */

export type SessionUser = {
  userId: string
  role: Role
  email: string
  displayName: string
  instagramHandle: string | null
}

/**
 * Живая строка пользователя по id из токена. `null` — пользователя больше нет.
 *
 * Отдельно от `getSessionUser`, потому что куки читаются только в запросе,
 * а эта половина проверяется тестом против живой базы.
 */
export async function findSessionUser(userId: string): Promise<SessionUser | null> {
  const [user] = await db
    .select({
      userId: users.id,
      role: users.role,
      email: users.email,
      displayName: users.displayName,
      instagramHandle: users.instagramHandle,
    })
    .from(users)
    .where(eq(users.id, userId))

  return user ?? null
}

/** Сессия вместе с живой строкой. `null` — гость ИЛИ удалённый пользователь. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await getSession()
  if (!session) return null

  return findSessionUser(session.userId)
}
