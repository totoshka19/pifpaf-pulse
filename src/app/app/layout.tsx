import { eq } from 'drizzle-orm'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { db, users } from '@/db'
import { requireSession } from '@/lib/auth/require-session'
import { LogoutButton } from './logout-button'

/**
 * Оболочка кабинета: одна шапка на все экраны `/app/*`.
 *
 * Имя пользователя читается здесь, а не на каждой странице: срез 6 добавит
 * дашборд и настройки, и три одинаковых запроса к users были бы платой
 * ни за что.
 */
export default async function AppLayout({ children }: LayoutProps<'/app'>) {
  const session = await requireSession()

  const [user] = await db
    .select({ displayName: users.displayName, role: users.role })
    .from(users)
    .where(eq(users.id, session.userId))

  // Пользователя удалили, а кука осталась — выкидываем на вход.
  if (!user) redirect('/login')

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-20 border-b border-[var(--border)] bg-[var(--bg)]/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <Link href="/app/reels" className="flex items-baseline gap-2">
            <span className="text-lg font-semibold tracking-tight">PifPaf&nbsp;Pulse</span>
            <span className="hidden text-xs text-[var(--muted)] sm:inline">
              аналитика рилсов
            </span>
          </Link>

          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-[var(--muted)] sm:inline">
              {user.displayName}
              {user.role === 'admin' && ' · админ'}
            </span>
            <LogoutButton />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
        {children}
      </main>
    </div>
  )
}
