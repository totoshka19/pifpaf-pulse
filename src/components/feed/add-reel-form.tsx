'use client'

import { useRef, useState } from 'react'
import type { ReelListRow } from '@/db/queries/list-reels'
import { normalizeReelUrl } from '@/lib/instagram/normalize-url'
import { reviveRow } from '@/lib/reels/parse'

type Props = {
  onAdded: (row: ReelListRow) => void
  onDuplicate: (id: string) => void
  onError: (message: string) => void
}

export function AddReelForm({ onAdded, onDuplicate, onError }: Props) {
  const input = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState('')
  const [hint, setHint] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    // Тот же модуль, что проверяет ссылку на сервере: разойтись они не могут.
    const parsed = normalizeReelUrl(value)
    if (!parsed.ok) {
      setHint(parsed.reason)
      input.current?.focus()
      return
    }

    setHint(null)
    setBusy(true)

    try {
      const response = await fetch('/api/reels', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: parsed.canonicalUrl }),
      })
      const data = await response.json().catch(() => null)

      if (response.status === 409 && data?.id) {
        onDuplicate(data.id)
        setValue('')
        return
      }

      if (!response.ok) {
        onError(data?.error ?? 'Не получилось добавить рилс. Попробуй ещё раз')
        return
      }

      // Оптимистичная строка: карточка появляется мгновенно, в статусе
      // pending и без метрик. Опрос в ленте заменит её настоящей.
      onAdded(
        reviveRow({
          id: data.id,
          shortcode: parsed.shortcode,
          url: parsed.canonicalUrl,
          caption: null,
          ownerUsername: null,
          thumbnailSrc: null,
          postedAt: null,
          syncStatus: 'pending',
          syncError: null,
          lastSyncedAt: null,
          views: null,
          likes: null,
          comments: null,
          capturedAt: null,
          createdAt: new Date().toISOString(),
          growth7d: null,
        }),
      )

      setValue('')
    } catch {
      onError('Не получилось связаться с сервером. Проверь интернет')
    } finally {
      setBusy(false)
    }
  }

  async function pasteFromClipboard() {
    try {
      const text = await navigator.clipboard.readText()
      setValue(text.trim())
      setHint(null)
      input.current?.focus()
    } catch {
      // Браузер вправе отказать в доступе к буферу без явного жеста —
      // это не ошибка, а нормальный отказ. Просто ставим курсор в поле.
      input.current?.focus()
    }
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-2 rounded-[var(--radius)] bg-white p-3 shadow-[var(--shadow)]"
    >
      <div className="flex flex-wrap gap-2">
        <input
          ref={input}
          value={value}
          onChange={(event) => {
            setValue(event.target.value)
            if (hint) setHint(null)
          }}
          placeholder="instagram.com/reel/Cxxxxxx/"
          inputMode="url"
          autoComplete="off"
          aria-invalid={hint !== null}
          aria-describedby={hint ? 'add-reel-hint' : undefined}
          className="min-w-0 flex-1 rounded-xl border border-[var(--border)] px-4 py-3 outline-none focus:border-[var(--accent)]"
        />

        <button
          type="button"
          onClick={pasteFromClipboard}
          className="rounded-xl border border-[var(--border)] px-4 py-3 text-sm hover:bg-[var(--accent-soft)]"
        >
          Вставить
        </button>

        <button
          type="submit"
          disabled={busy}
          className="rounded-xl bg-[var(--ink)] px-6 py-3 font-medium text-white transition hover:opacity-90 disabled:opacity-50"
        >
          {busy ? 'Добавляем…' : 'Добавить'}
        </button>
      </div>

      {hint && (
        <p id="add-reel-hint" role="alert" className="text-sm text-[var(--down)]">
          {hint}
        </p>
      )}
    </form>
  )
}
