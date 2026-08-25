'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useState } from 'react'

/**
 * Временный экран входа: рабочий, но без дизайна — оформление идёт срезом 8.
 * Нужен уже сейчас, потому что `proxy.ts` редиректит сюда с `/app`.
 */

type Mode = 'login' | 'register'

function AuthForm() {
  const router = useRouter()
  const params = useSearchParams()
  const next = params.get('next') ?? '/app'

  const [mode, setMode] = useState<Mode>('login')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setBusy(true)

    const form = new FormData(event.currentTarget)
    const payload = {
      email: form.get('email'),
      password: form.get('password'),
      ...(mode === 'register' ? { displayName: form.get('displayName') } : {}),
    }

    try {
      const response = await fetch(`/api/auth/${mode}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        const data = await response.json().catch(() => null)
        setError(data?.error ?? 'Что-то пошло не так. Попробуй ещё раз')
        return
      }

      router.push(next)
      router.refresh()
    } catch {
      setError('Не получилось связаться с сервером. Проверь интернет')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-6">
      <div>
        <h1 className="text-2xl font-semibold">PifPaf Pulse</h1>
        <p className="mt-1 text-sm opacity-60">
          {mode === 'login' ? 'Рады видеть снова' : 'Заведём кабинет за минуту'}
        </p>
      </div>

      <form onSubmit={submit} className="flex flex-col gap-3">
        {mode === 'register' && (
          <input
            name="displayName"
            placeholder="Как тебя зовут"
            autoComplete="name"
            required
            className="rounded-xl border border-[var(--border)] px-4 py-3 outline-none focus:border-[var(--accent)]"
          />
        )}

        <input
          name="email"
          type="email"
          placeholder="Почта"
          autoComplete="email"
          required
          className="rounded-xl border border-[var(--border)] px-4 py-3 outline-none focus:border-[var(--accent)]"
        />

        <input
          name="password"
          type="password"
          placeholder="Пароль"
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          required
          className="rounded-xl border border-[var(--border)] px-4 py-3 outline-none focus:border-[var(--accent)]"
        />

        {error && (
          <p role="alert" className="text-sm text-[var(--down)]">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="rounded-xl bg-[var(--ink)] px-4 py-3 font-medium text-[var(--on-ink)] disabled:opacity-50"
        >
          {busy ? 'Секунду…' : mode === 'login' ? 'Войти' : 'Создать кабинет'}
        </button>
      </form>

      <button
        type="button"
        onClick={() => {
          setMode(mode === 'login' ? 'register' : 'login')
          setError(null)
        }}
        className="text-sm underline opacity-60 hover:opacity-100"
      >
        {mode === 'login' ? 'Ещё нет кабинета — зарегистрироваться' : 'Уже есть кабинет — войти'}
      </button>
    </main>
  )
}

export default function LoginPage() {
  // useSearchParams требует Suspense-границы при пререндере.
  return (
    <Suspense>
      <AuthForm />
    </Suspense>
  )
}
