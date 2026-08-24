import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { PasswordForm } from '@/components/settings/password-form'
import { ProfileForm } from '@/components/settings/profile-form'
import { Avatar } from '@/components/ui/avatar'
import { statsOverview } from '@/db/queries/stats-overview'
import { requireSession } from '@/lib/auth/require-session'
import { findSessionUser } from '@/lib/auth/session-user'
import { formatExactMsk } from '@/lib/format/date'
import { formatCount, formatExact, NO_DATA } from '@/lib/format/number'
import { plural } from '@/lib/format/plural'
import { db, users } from '@/db'
import { eq } from 'drizzle-orm'

export const metadata: Metadata = { title: 'Настройки' }

/**
 * Личный кабинет.
 *
 * ТЗ называет его отдельным пунктом, поэтому это не техническая страница
 * с двумя инпутами, а экран: кто ты, что у тебя за цифры, как сменить пароль.
 *
 * Сводка считается тем же `statsOverview`, что кормит дашборд, — четвёртого
 * запроса ради четырёх чисел не заводим.
 */
export default async function SettingsPage() {
  const session = await requireSession()

  const [profile, overview, [registered]] = await Promise.all([
    findSessionUser(session.userId),
    statsOverview(session.userId),
    // Дата регистрации не нужна нигде, кроме этого экрана, поэтому её нет
    // в SessionUser: тащить лишнюю колонку в каждый рендер кабинета незачем.
    db.select({ createdAt: users.createdAt }).from(users).where(eq(users.id, session.userId)),
  ])

  // Пользователя удалили, а токен ещё жив — см. session-user.ts.
  if (!profile) redirect('/login')

  const reels = `${overview.reelsCount} ${plural(overview.reelsCount, [
    'рилс',
    'рилса',
    'рилсов',
  ])}`

  const numbers = [
    { label: 'Рилсов', value: reels, title: undefined },
    {
      label: 'Просмотров всего',
      value: formatCount(overview.totalViews),
      title: formatExact(overview.totalViews),
    },
    {
      label: 'В среднем на рилс',
      value: formatCount(overview.avgViews),
      title: formatExact(overview.avgViews),
    },
    {
      label: 'Вовлечённость',
      value:
        overview.erPercent === null
          ? NO_DATA
          : `${String(overview.erPercent).replace('.', ',')} %`,
      title: undefined,
    },
  ]

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-4">
        <Avatar name={profile.displayName} size={56} />

        <div className="flex min-w-0 flex-col">
          <h1 className="truncate text-2xl font-semibold tracking-tight">
            {profile.displayName}
          </h1>
          <p className="truncate text-sm text-[var(--muted)]">
            {profile.email}
            {profile.instagramHandle && ` · @${profile.instagramHandle}`}
          </p>
        </div>
      </div>

      <section className="flex flex-col gap-4 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--shadow)] sm:p-6">
        <h2 className="text-base font-semibold">Твои цифры</h2>

        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {numbers.map((item) => (
            <div key={item.label} className="flex flex-col gap-0.5">
              <dt className="text-xs text-[var(--muted)]">{item.label}</dt>
              <dd className="text-lg font-semibold tabular-nums" title={item.title}>
                {item.value}
              </dd>
            </div>
          ))}
        </dl>

        {registered && (
          <p className="text-xs text-[var(--muted)]">
            В PifPaf Pulse с {formatExactMsk(registered.createdAt)} по московскому времени
          </p>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="flex flex-col gap-4 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--shadow)] sm:p-6">
          <h2 className="text-base font-semibold">Профиль</h2>
          <ProfileForm
            initialName={profile.displayName}
            initialHandle={profile.instagramHandle}
          />
        </section>

        <section className="flex flex-col gap-4 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--shadow)] sm:p-6">
          <h2 className="text-base font-semibold">Пароль</h2>
          <PasswordForm />
        </section>
      </div>
    </div>
  )
}
