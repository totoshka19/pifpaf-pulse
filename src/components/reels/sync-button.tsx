'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

/**
 * Кнопка «Обновить» на экране рилса.
 *
 * Своя, а не та, что в ленте: там кнопка живёт внутри списка с оптимистичным
 * обновлением строки и опросом статуса, здесь достаточно перезапросить
 * серверный компонент через `router.refresh()`.
 *
 * Ответ 429 — это НЕ ошибка, а штатный троттлинг: рилс уже обновляли меньше
 * часа назад. Текст берём из ответа: он написан по-русски и человеческим
 * языком, без кодов («загляни через 40 минут»).
 */
export function SyncButton({ reelId, disabled }: { reelId: string; disabled?: boolean }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  async function sync() {
    setBusy(true)
    setMessage(null)

    try {
      const response = await fetch(`/api/reels/${reelId}/sync`, { method: 'POST' })
      const body = await response.json().catch(() => null)

      if (!response.ok) {
        setMessage(body?.error ?? 'Не получилось обновить. Попробуй ещё раз через минуту.')
        return
      }

      setMessage('Пошли за свежими цифрами — данные подтянутся через минуту.')
      // Перечитываем серверный компонент: прогон уже записан в sync_runs,
      // и лог синхронизаций обязан это показать сразу.
      router.refresh()
    } catch {
      // Сеть отвалилась. Код ошибки блогеру не поможет, объяснение — да.
      setMessage('Нет связи с сервером. Проверь интернет и попробуй снова.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={sync}
        disabled={busy || disabled}
        className="rounded-xl bg-[var(--ink)] px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {busy ? 'Обновляем…' : 'Обновить'}
      </button>

      {/* role=status: сообщение появляется после действия, и скринридер
          обязан его зачитать, не уводя фокус с кнопки. */}
      {message && (
        <p role="status" className="text-xs text-[var(--muted)]">
          {message}
        </p>
      )}
    </div>
  )
}
