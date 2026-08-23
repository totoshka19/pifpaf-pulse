import { eq } from 'drizzle-orm'
import { redirect } from 'next/navigation'
import { db, users } from '@/db'
import { requireSession } from '@/lib/auth/require-session'
import { LogoutButton } from './logout-button'

/**
 * Заглушка кабинета. Настоящий дашборд — срез 6.
 * Сейчас её задача одна: доказать, что цепочка «вход → сессия → свои данные»
 * работает от начала до конца.
 */
export default async function AppPage() {
  const session = await requireSession()

  const [user] = await db
    .select({ displayName: users.displayName, email: users.email, role: users.role })
    .from(users)
    .where(eq(users.id, session.userId))

  // Пользователя удалили, а кука осталась — выкидываем на вход.
  if (!user) redirect('/login')

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-6 px-6">
      <div>
        <h1 className="text-2xl font-semibold">Привет, {user.displayName}</h1>
        <p className="mt-1 text-sm opacity-60">
          {user.email}
          {user.role === 'admin' && ' · админ'}
        </p>
      </div>

      <p className="text-sm opacity-60">
        Кабинет пока пустой — лента рилсов и аналитика появятся дальше по плану.
      </p>

      <LogoutButton />
    </main>
  )
}
