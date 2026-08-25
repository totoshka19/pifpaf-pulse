import Link from 'next/link'
import { DemoLoginButton } from '@/components/demo-login-button'

/**
 * Главная: объяснить, что это за сервис, за пять секунд — и дать войти.
 *
 * СТРАНИЦА ОБЯЗАНА ОСТАВАТЬСЯ СТАТИЧЕСКОЙ. Любое чтение сессии или базы
 * превратит её в серверную функцию: в выводе `next build` она станет `ƒ`
 * вместо `○`, и первое впечатление подорожает на ~155 мс. Уже вошедшего
 * пользователя перехватывает /login, ему там дешевле.
 *
 * `process.env.DEMO_EMAIL` статичности НЕ мешает: переменная читается на
 * СБОРКЕ и просто решает, попадёт кнопка демо в разметку или нет. Это
 * именно то, что нужно, — на копии проекта без демо-кабинета кнопка не
 * появится вовсе, а не будет вести в 404.
 */
export default function HomePage() {
  const hasDemo = Boolean(process.env.DEMO_EMAIL)

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-8 px-6">
      <div className="flex flex-col gap-3">
        <p className="text-sm font-medium tracking-wide text-[var(--muted)] uppercase">
          PifPaf AI
        </p>

        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
          PifPaf&nbsp;Pulse
        </h1>

        <p className="text-lg text-[var(--muted)]">
          Аналитика рилсов для внутренних блогеров. Вставляешь ссылку из Instagram —
          просмотры, дата и обложка подтягиваются сами и обновляются дальше без тебя.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Link
          href="/login"
          className="rounded-[var(--radius)] bg-[var(--ink)] px-6 py-3 font-medium text-[var(--on-ink)] transition hover:opacity-90"
        >
          Войти
        </Link>

        {hasDemo && <DemoLoginButton />}
      </div>

      {hasDemo && (
        <p className="-mt-4 text-sm text-[var(--muted)]">
          Демо — настоящий кабинет с настоящими рилсами. Смотри, добавляй свои
          ссылки, ничего не сломаешь.
        </p>
      )}

      <p className="text-sm text-[var(--muted)]">
        Лента с сеткой и таблицей, дашборд с динамикой просмотров и подсказкой,
        когда лучше постить, экран рилса с историей роста. Метрики обновляются
        по расписанию — сами, без единого нажатия.
      </p>
    </main>
  )
}
