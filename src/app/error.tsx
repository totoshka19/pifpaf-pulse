'use client'

import { useEffect } from 'react'
import Link from 'next/link'

/**
 * Экран на случай, когда что-то упало в рантайме.
 *
 * Обязан быть клиентским: Next передаёт сюда `reset()`, и без него
 * единственным выходом осталась бы перезагрузка страницы. `reset()` пробует
 * отрисовать сегмент заново — для транзиентного сбоя (обрыв до Neon, разбудившийся
 * с задержкой инстанс) этого достаточно, и пользователь не теряет место, где был.
 *
 * ТЕКСТ ОШИБКИ НАРУЖУ НЕ ОТДАЁМ. Тот же довод, что в `handleError`
 * (src/lib/api/respond.ts): в сообщении драйвера Postgres может оказаться
 * строка подключения с паролем. Наружу — человеческая фраза, оригинал уходит
 * в консоль, а на проде его подберут логи функции Netlify.
 *
 * `digest` показываем: это единственная ниточка от жалобы пользователя к
 * конкретной записи в логах, и сам по себе он ничего не раскрывает.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[app]', error)
  }, [error])

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-8 px-6">
      <div className="flex flex-col gap-3">
        <p className="text-sm font-medium tracking-wide text-[var(--muted)] uppercase">
          Сбой
        </p>

        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
          Что-то пошло не так
        </h1>

        <p className="text-lg text-[var(--muted)]">
          Это с нашей стороны, а не с твоей. Данные на месте — попробуй ещё раз,
          обычно со второго захода открывается.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={reset}
          className="rounded-[var(--radius)] bg-[var(--ink)] px-6 py-3 font-medium text-[var(--on-ink)] transition hover:opacity-90"
        >
          Попробовать снова
        </button>

        <Link
          href="/app"
          className="rounded-[var(--radius)] px-6 py-3 font-medium text-[var(--muted)] transition hover:text-[var(--ink)]"
        >
          На дашборд
        </Link>
      </div>

      {error.digest && (
        <p className="text-sm text-[var(--muted)]">
          Если повторяется — покажи этот код: <code>{error.digest}</code>
        </p>
      )}
    </main>
  )
}
