'use client'

import { useCallback, useState } from 'react'

export type Toast = { id: number; text: string; kind: 'ok' | 'error' }

let nextId = 0

/**
 * Потолок одновременно видимых тостов.
 *
 * Без него серия быстрых действий (удалить карточку, удалить, удалить)
 * копит тост на тост на 4 секунды каждый. `pointer-events-none` у стека
 * не даёт им перекрыть клик мимо, но на невысоком телефонном экране стопка
 * из трёх-четырёх штук закрывает СОБОЙ кнопки действий карточки — те всегда
 * видимы на мобильном (см. reel-card.tsx), и именно их и закрывает стопка.
 */
const MAX_VISIBLE = 2

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([])

  const push = useCallback((text: string, kind: 'ok' | 'error' = 'ok') => {
    const id = nextId++
    // Новый тост всегда попадает на экран: если лимит уже занят, старейший
    // уходит немедленно, а не ждёт своих 4 секунд.
    setToasts((prev) => [...prev, { id, text, kind }].slice(-MAX_VISIBLE))
    setTimeout(() => setToasts((prev) => prev.filter((toast) => toast.id !== id)), 4000)
  }, [])

  return { toasts, push }
}

export function ToastStack({ toasts }: { toasts: Toast[] }) {
  return (
    // aria-live: сообщение о неудавшемся удалении обязано дойти до того,
    // кто не смотрит в правый нижний угол.
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex flex-col items-center gap-2 sm:right-6 sm:left-auto sm:items-end"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="rounded-xl px-4 py-2 text-sm text-white shadow-[var(--shadow)]"
          style={{ background: toast.kind === 'error' ? 'var(--down)' : 'var(--ink)' }}
        >
          {toast.text}
        </div>
      ))}
    </div>
  )
}
