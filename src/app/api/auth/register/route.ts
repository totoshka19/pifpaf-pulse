import { eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { db, users } from '@/db'
import { setSessionCookie } from '@/lib/auth/cookie'
import { hashPassword, validatePassword } from '@/lib/auth/password'
import { signSession } from '@/lib/auth/session'

export const runtime = 'nodejs'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)

  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
  const password = typeof body?.password === 'string' ? body.password : ''
  const displayName = typeof body?.displayName === 'string' ? body.displayName.trim() : ''

  if (!EMAIL_RE.test(email)) {
    return NextResponse.json(
      { error: 'Проверь email — кажется, в нём опечатка' },
      { status: 400 },
    )
  }

  const passwordError = validatePassword(password)
  if (passwordError) {
    return NextResponse.json({ error: passwordError }, { status: 400 })
  }

  if (!displayName) {
    return NextResponse.json({ error: 'Как тебя зовут?' }, { status: 400 })
  }

  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))

  if (existing) {
    return NextResponse.json({ error: 'Такой email уже зарегистрирован' }, { status: 409 })
  }

  const [user] = await db
    .insert(users)
    .values({ email, passwordHash: await hashPassword(password), displayName })
    .returning({ id: users.id, role: users.role })

  const token = await signSession({ userId: user.id, role: user.role })

  return setSessionCookie(
    NextResponse.json({ displayName }, { status: 201 }),
    token,
  )
}
