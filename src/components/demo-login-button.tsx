'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Кнопка «Посмотреть демо» на лендинге.
 *
 * Клиентская, потому что после ответа надо увести пользователя в кабинет.
 * Лендинг при этом ОСТАЁТСЯ СТАТИЧЕСКИМ: клиентский островок не превращает
 * страницу в серверную функцию, а решение, рисовать кнопку или нет,
 * принимается на сборке — см. `src/app/page.tsx`.
 *
 * `router.refresh()` перед переходом обязателен: кабинет — серверные
 * компоненты, и без сброса кеша роутера Next может отрисовать их с той
 * сессией, которой ещё не было в момент предыдущей навигации.
 */
export function DemoLoginButton() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  async function enter() {
    setBusy(true)
    setFailed(false)

    try {
      const response = await fetch('/api/auth/demo', { method: 'POST' })
      if (!response.ok) throw new Error(String(response.status))

      router.refresh()
      router.push('/app')
    } catch {
      // Код наружу не показываем — тот же тон, что во всех остальных ошибках.
      setFailed(true)
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={enter}
        disabled={busy}
        className="rounded-[var(--radius)] border border-[var(--border)] px-6 py-3 font-medium transition hover:bg-[var(--chip)] disabled:opacity-50"
      >
        {busy ? 'Заходим…' : 'Посмотреть демо'}
      </button>

      {failed && (
        <p role="alert" className="text-sm text-[var(--down)]">
          Демо сейчас недоступно. Можно зарегистрироваться — это быстро.
        </p>
      )}
    </div>
  )
}
