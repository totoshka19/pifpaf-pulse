'use client'

import { useState } from 'react'
import { ToastStack, useToasts } from '@/components/ui/toast'
import { validatePassword } from '@/lib/auth/password'

/**
 * Смена пароля.
 *
 * Повтор нового пароля проверяется ТОЛЬКО здесь: сервер про него ничего
 * не знает и знать не должен — это защита от опечатки, а не правило доступа.
 *
 * Про `autoComplete`. Значения расставлены не для красоты: без них менеджер
 * паролей подставит текущий пароль в поле нового и предложит сохранить
 * мусор. `current-password` у первого поля, `new-password` у двух остальных —
 * так браузер понимает, что происходит.
 *
 * Чего мы НЕ пишем: «вы вышли на других устройствах». Это была бы неправда.
 * Сессия — подписанный JWT без серверного хранилища, отозвать выданные токены
 * нечем, и старый доживёт свои тридцать дней.
 */
export function PasswordForm() {
  const { toasts, push } = useToasts()

  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [repeat, setRepeat] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!current) {
      push('Введи текущий пароль', 'error')
      return
    }

    const error = validatePassword(next)
    if (error) {
      push(error, 'error')
      return
    }

    if (next !== repeat) {
      push('Новый пароль и повтор не совпадают', 'error')
      return
    }

    setBusy(true)

    try {
      const response = await fetch('/api/settings/password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      })
      const data = await response.json().catch(() => null)

      if (!response.ok) {
        push(data?.error ?? 'Не получилось сменить пароль', 'error')
        return
      }

      // Чистим все три поля: оставленный в форме пароль увидит следующий,
      // кто подойдёт к этому экрану.
      setCurrent('')
      setNext('')
      setRepeat('')
      push('Пароль изменён')
    } catch {
      push('Нет связи с сервером. Проверь интернет', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">Текущий пароль</span>
          <input
            type="password"
            value={current}
            onChange={(event) => setCurrent(event.target.value)}
            autoComplete="current-password"
            className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">Новый пароль</span>
          <input
            type="password"
            value={next}
            onChange={(event) => setNext(event.target.value)}
            autoComplete="new-password"
            className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
          />
          <span className="text-xs text-[var(--muted)]">Не короче восьми символов</span>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">Ещё раз новый</span>
          <input
            type="password"
            value={repeat}
            onChange={(event) => setRepeat(event.target.value)}
            autoComplete="new-password"
            className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
          />
        </label>

        <button
          type="submit"
          disabled={busy}
          className="self-start rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm font-medium transition-colors hover:bg-[var(--accent-soft)] disabled:opacity-50"
        >
          {busy ? 'Меняем…' : 'Сменить пароль'}
        </button>
      </form>

      <ToastStack toasts={toasts} />
    </>
  )
}
