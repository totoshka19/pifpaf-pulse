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
    // `display: contents` — обёртки в раскладке нет, кнопка и сообщение
    // становятся прямыми элементами строки действий на экране рилса.
    //
    // Раньше здесь была колонка `flex flex-col`, и она ломала строку сразу
    // вдвойне. Длинный текст троттлинга («Обновляли совсем недавно. Instagram
    // пересчитывает счётчики не чаще раза в час — загляни через 22 минуты»)
    // растягивал колонку на всю ширину, а кнопка внутри растягивалась вместе
    // с ней: `align-items` по умолчанию `stretch`, поэтому «Обновить»
    // расползалась через весь экран. Заодно раздутая колонка отодвигала
    // «Открыть в Instagram» к самому краю.
    //
    // Теперь кнопка занимает свою ширину, а сообщение уходит на отдельную
    // строку через `w-full` — тем же приёмом, что текст ошибки в
    // `sync-log.tsx` внутри своей `flex-wrap`-строки.
    <div className="contents">
      <button
        type="button"
        onClick={sync}
        disabled={busy || disabled}
        className="rounded-xl bg-[var(--ink)] px-4 py-2 text-sm font-medium text-[var(--on-ink)] transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {busy ? 'Обновляем…' : 'Обновить'}
      </button>

      {/* role=status: сообщение появляется после действия, и скринридер
          обязан его зачитать, не уводя фокус с кнопки.

          `order-last` двигает сообщение в конец ТОЛЬКО визуально: без него
          оно вставало между «Обновить» и «Открыть в Instagram» и сдвигало
          вторую кнопку на строку вниз в момент появления — кнопки прыгали
          под курсором. В разметке сообщение по-прежнему идёт сразу за своей
          кнопкой, то есть порядок чтения остаётся логичным. */}
      {message && (
        <p role="status" className="order-last w-full text-xs text-[var(--muted)]">
          {message}
        </p>
      )}
    </div>
  )
}
