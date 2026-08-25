'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { ToastStack, useToasts } from '@/components/ui/toast'
import { normalizeInstagramHandle, validateDisplayName } from '@/lib/profile/validate'

/**
 * Форма профиля: имя и инстаграм-хендл.
 *
 * Валидация — ТЕМИ ЖЕ чистыми функциями, что на сервере. Модуль
 * `lib/profile/validate` не зависит ни от Node, ни от базы, поэтому уезжает
 * в браузер как есть и разойтись с серверной проверкой не может по
 * построению. Тот же приём, что с `normalizeReelUrl` в ленте.
 *
 * Клиентская проверка при этом не заменяет серверную, а экономит круг по
 * сети: сервер всё равно проверяет всё заново — запрос может прийти и мимо
 * этой формы.
 */
export function ProfileForm({
  initialName,
  initialHandle,
}: {
  initialName: string
  initialHandle: string | null
}) {
  const router = useRouter()
  const { toasts, push } = useToasts()

  const [name, setName] = useState(initialName)
  const [handle, setHandle] = useState(initialHandle ?? '')
  const [busy, setBusy] = useState(false)

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const nameError = validateDisplayName(name)
    if (nameError) {
      push(nameError, 'error')
      return
    }

    const parsed = normalizeInstagramHandle(handle)
    if (!parsed.ok) {
      push(parsed.reason, 'error')
      return
    }

    setBusy(true)

    try {
      const response = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ displayName: name, instagramHandle: handle }),
      })
      const data = await response.json().catch(() => null)

      if (!response.ok) {
        push(data?.error ?? 'Не получилось сохранить', 'error')
        return
      }

      // Показываем то, что реально легло в базу: «@PifPafAI» превращается
      // в «pifpafai», и поле обязано это показать, а не притворяться.
      setName(data.displayName)
      setHandle(data.instagramHandle ?? '')
      push('Сохранили')

      // Имя стоит в шапке кабинета — её рисует серверный layout.
      router.refresh()
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
          <span className="text-sm font-medium">Имя</span>
          <input
            name="displayName"
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoComplete="name"
            maxLength={80}
            className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
          />
          <span className="text-xs text-[var(--muted)]">Как к тебе обращаться в кабинете</span>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">Инстаграм</span>
          <input
            name="instagramHandle"
            value={handle}
            onChange={(event) => setHandle(event.target.value)}
            placeholder="pifpafai"
            autoComplete="off"
            className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
          />
          <span className="text-xs text-[var(--muted)]">
            Можно вставить ссылку целиком — разберём сами. Поле необязательное.
          </span>
        </label>

        <button
          type="submit"
          disabled={busy}
          className="self-start rounded-xl bg-[var(--ink)] px-4 py-2 text-sm font-medium text-[var(--on-ink)] transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {busy ? 'Сохраняем…' : 'Сохранить'}
        </button>
      </form>

      <ToastStack toasts={toasts} />
    </>
  )
}
