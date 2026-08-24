'use client'

import { useState } from 'react'

/**
 * Обложка рилса с honest-плейсхолдером.
 *
 * Правило из чек-листа PLAN.md §12: НИКОГДА не показывать сломанную иконку
 * картинки. Это первое, что бросается в глаза при беглом просмотре ленты,
 * и один битый квадрат обесценивает впечатление от всех остальных.
 *
 * Обложки может не быть штатно: ссылка Instagram протухает за ~4,5 суток,
 * и рилс, добавленный давно, мог не успеть попасть в дозаливку.
 */

type Props = {
  reelId: string
  author?: string | null
  caption?: string | null
  /** Свежие карточки в начале ленты грузим сразу, остальные лениво. */
  priority?: boolean
  /** В строке таблицы портретная обложка растянула бы строку до 70 px. */
  ratio?: 'portrait' | 'square'
  /** Момент последней синхронизации рилса — версия обложки, см. ниже. */
  version?: number | null
}

export function ReelCover({
  reelId,
  author,
  caption,
  priority = false,
  ratio = 'portrait',
  version,
}: Props) {
  const src = version ? `/api/thumbnails/${reelId}?v=${version}` : `/api/thumbnails/${reelId}`

  // Храним НЕ факт поломки, а то, КАКОЙ именно src сломался. Тогда сброс
  // не нужен: меняется version — меняется src — сравнение перестаёт совпадать,
  // и картинка пробуется заново. С булевым флагом плейсхолдер залипал навсегда,
  // потому что карточка обновляется на месте и компонент не размонтируется.
  const [brokenSrc, setBrokenSrc] = useState<string | null>(null)
  const broken = brokenSrc === src

  const letter = (author ?? '').trim().charAt(0).toUpperCase() || '?'
  const alt = caption?.trim()
    ? caption.trim().slice(0, 80)
    : author
      ? `Рилс автора ${author}`
      : 'Обложка рилса'

  return (
    <div
      className={`relative w-full overflow-hidden bg-[#dbe4f5] ${
        ratio === 'square' ? 'aspect-square rounded-lg' : 'aspect-9/16 rounded-[var(--radius)]'
      }`}
    >
      {broken ? (
        <div
          className="flex h-full w-full items-center justify-center bg-linear-to-br from-[#c7d7ff] to-[#eef4ff]"
          role="img"
          aria-label={author ? `Обложка недоступна, автор ${author}` : 'Обложка недоступна'}
        >
          <span className="text-5xl font-semibold text-[var(--ink)]/30 select-none">
            {letter}
          </span>
        </div>
      ) : (
        // Обычный img, а не next/image: картинка уже нормализована нами —
        // ровно один размер и ровно один формат. Слой оптимизации поверх
        // добавил бы обработку и привязку к возможностям площадки, не дав
        // ничего взамен.
        <img
          src={src}
          alt={alt}
          loading={priority ? 'eager' : 'lazy'}
          decoding="async"
          className="h-full w-full object-cover"
          onError={() => setBrokenSrc(src)}
        />
      )}
    </div>
  )
}
