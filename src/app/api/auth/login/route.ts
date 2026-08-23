import { eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { db, users } from '@/db'
import { setSessionCookie } from '@/lib/auth/cookie'
import { hashPassword, verifyPassword } from '@/lib/auth/password'
import { signSession } from '@/lib/auth/session'

export const runtime = 'nodejs'

/**
 * Один и тот же ответ на неизвестный email и на неверный пароль.
 * Разные тексты позволяют перебором выяснить, кто зарегистрирован в сервисе.
 */
const invalid = () =>
  NextResponse.json({ error: 'Неверный email или пароль' }, { status: 401 })

/**
 * Хеш-пустышка для несуществующего пользователя.
 *
 * Без него ответ на незнакомый email приходит мгновенно, а на знакомый —
 * через ~80 мс, которые занимает bcrypt. По этой разнице email перебирается
 * даже при одинаковом тексте ошибки. Поэтому в «пустой» ветке гоняем bcrypt
 * вхолостую, чтобы время ответа совпадало.
 */
const DUMMY_HASH = await hashPassword('время-должно-совпадать')

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)

  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
  const password = typeof body?.password === 'string' ? body.password : ''

  if (!email || !password) return invalid()

  const [user] = await db.select().from(users).where(eq(users.email, email))

  if (!user) {
    await verifyPassword(password, DUMMY_HASH)
    return invalid()
  }

  if (!(await verifyPassword(password, user.passwordHash))) return invalid()

  const token = await signSession({ userId: user.id, role: user.role })

  return setSessionCookie(NextResponse.json({ displayName: user.displayName }), token)
}
