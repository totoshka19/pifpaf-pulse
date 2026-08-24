import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db, users } from '@/db'
import { findSessionUser } from './session-user'

/**
 * Живая строка пользователя за токеном — на ЖИВОЙ базе Neon.
 *
 * Тест закрывает петлю редиректов, найденную в срезе 6: токен переживает
 * пользователя, потому что подписан на 30 дней и не хранится на сервере.
 * `proxy.ts` и `/login` верили одной только подписи, а оболочка кабинета
 * требовала ещё и строку в `users` — и два экрана начинали перебрасывать
 * друг на друга до отказа браузера.
 *
 * Здесь проверяется единственное определение «сессия жива», которым теперь
 * пользуются оба экрана.
 */

const MARKER = 'session-user-test@example.invalid'

let userId: string

beforeAll(async () => {
  await db.delete(users).where(eq(users.email, MARKER))

  const [user] = await db
    .insert(users)
    .values({ email: MARKER, passwordHash: 'x', displayName: 'Живой' })
    .returning({ id: users.id })

  userId = user.id
})

afterAll(async () => {
  await db.delete(users).where(eq(users.email, MARKER))
})

describe('findSessionUser', () => {
  it('отдаёт живого пользователя по id из токена', async () => {
    const found = await findSessionUser(userId)

    expect(found).not.toBeNull()
    expect(found?.displayName).toBe('Живой')
    expect(found?.email).toBe(MARKER)
    expect(found?.role).toBe('blogger')
  })

  it('отдаёт null, когда пользователя уже удалили', async () => {
    // Ровно то, что делает уборка тестовых аккаунтов: строки нет, токен цел.
    await db.delete(users).where(eq(users.email, MARKER))

    expect(await findSessionUser(userId)).toBeNull()
  })

  it('отдаёт null на id, которого никогда не было', async () => {
    expect(await findSessionUser('00000000-0000-4000-8000-000000000000')).toBeNull()
  })
})
