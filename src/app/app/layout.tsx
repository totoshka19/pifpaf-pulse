import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/auth/session-user'
import { LogoutButton } from './logout-button'
import { AppNav } from './nav'

/**
 * Оболочка кабинета: одна шапка на все экраны `/app/*`.
 *
 * Имя пользователя читается здесь, а не на каждой странице: срез 6 добавил
 * дашборд и настройки, и три одинаковых запроса к users были бы платой
 * ни за что.
 */
export default async function AppLayout({ children }: LayoutProps<'/app'>) {
  const user = await getSessionUser()

  // Пользователя удалили, а кука осталась — выкидываем на вход. Форма входа
  // теперь проверяет то же самое и обратно сюда не отправит.
  if (!user) redirect('/login')

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-20 border-b border-[var(--border)] bg-[var(--bg)]/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
          <Link href="/app" className="flex items-baseline gap-2">
            <span className="text-lg font-semibold tracking-tight">PifPaf&nbsp;Pulse</span>
            <span className="hidden text-xs text-[var(--muted)] lg:inline">
              аналитика рилсов
            </span>
          </Link>

          {/* На узком экране навигация переезжает на свою строку: три пункта,
              имя и «Выйти» в 375px в один ряд не помещаются. Делает это
              order-last вместе с w-full, а не второй экземпляр компонента —
              двух ориентиров <nav> с одинаковой подписью быть не должно. */}
          <AppNav className="order-last w-full sm:order-none sm:w-auto" />

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
