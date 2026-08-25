'use client'

import { useEffect, useRef } from 'react'

type Props = {
  open: boolean
  title: string
  text: string
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
}

/**
 * Нативный `<dialog>`, а не самодельная модалка.
 *
 * `showModal()` бесплатно даёт ловушку фокуса, закрытие по Esc, блокировку
 * фона и правильную роль для скринридера. Повторять это руками — сто строк,
 * которые всё равно окажутся хуже.
 */
export function ConfirmDialog({ open, title, text, confirmLabel, onConfirm, onCancel }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const node = dialog.current
    if (!node) return

    if (open && !node.open) node.showModal()
    if (!open && node.open) node.close()
  }, [open])

  return (
    <dialog
      ref={dialog}
      onCancel={(event) => {
        // Esc закрывает нативно, но состояние в React об этом не узнает.
        event.preventDefault()
        onCancel()
      }}
      className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-[var(--radius)] p-0 backdrop:bg-black/40"
    >
      <div className="flex flex-col gap-3 p-5">
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="text-sm text-[var(--muted)]">{text}</p>

        <div className="mt-2 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-xl border border-[var(--border)] px-4 py-2 text-sm hover:bg-[var(--chip)]"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-xl px-4 py-2 text-sm font-medium text-[var(--on-ink)]"
            style={{ background: 'var(--down)' }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  )
}
