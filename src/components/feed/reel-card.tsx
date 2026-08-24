'use client'

import { ReelCover } from '@/components/reel-cover'
import type { ReelCardModel } from '@/lib/reels/view-model'

type Props = {
  card: ReelCardModel
  highlighted?: boolean
  /** Первые карточки грузят обложку сразу, остальные лениво. */
  priority?: boolean
  onSync: (id: string) => void
  onDelete: (id: string) => void
}

export function ReelCard({ card, highlighted = false, priority = false, onSync, onDelete }: Props) {
  const busy = card.state === 'loading' || card.state === 'refreshing'

  return (
    <article
      id={`reel-${card.id}`}
      className={`group flex flex-col gap-2 rounded-[var(--radius)] transition-shadow duration-500 ${
        highlighted ? 'ring-2 ring-[var(--accent)] ring-offset-2' : ''
      }`}
    >
      <div className="relative">
        <a
          href={card.url}
          target="_blank"
          rel="noopener noreferrer"
          className="block transition-transform duration-200 hover:-translate-y-0.5"
          title={`Открыть в Instagram: ${card.caption}`}
        >
          <ReelCover
            reelId={card.id}
            author={card.author}
            caption={card.caption}
            priority={priority}
            version={card.coverVersion}
          />

          {/* Просмотры поверх обложки: главная цифра карточки. Градиент —
              чтобы белый текст читался на любой картинке. */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 rounded-b-[var(--radius)] bg-linear-to-t from-black/70 to-transparent px-3 pt-8 pb-2">
            <p className="text-xl font-semibold text-white" title={card.viewsTitle}>
              {card.views}
            </p>
            <p className="text-[11px] text-white/70">просмотров</p>
          </div>
        </a>

        {card.growth && (
          <span
            className="absolute top-2 right-2 rounded-full px-2 py-0.5 text-[11px] font-medium text-white"
            style={{ background: card.growth.direction === 'up' ? 'var(--up)' : 'var(--down)' }}
            title="Прирост просмотров за 7 дней"
          >
            {card.growth.text}
          </span>
        )}

        {busy && (
          <div className="absolute inset-0 flex items-end rounded-[var(--radius)] bg-white/60 p-3 backdrop-blur-[1px]">
            <span className="animate-pulse rounded-full bg-white px-2 py-1 text-[11px] shadow-[var(--shadow)]">
              {card.message}
            </span>
          </div>
        )}
      </div>

      <p className="line-clamp-2 text-sm leading-snug" title={card.caption}>
        {card.caption}
      </p>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--muted)]">
        <span title={card.postedTitle}>{card.posted}</span>
        <span aria-label={`Лайков: ${card.likes}`}>♥ {card.likes}</span>
        <span aria-label={`Комментариев: ${card.comments}`}>💬 {card.comments}</span>
        <span title="Вовлечённость: (лайки + комментарии) ÷ просмотры">ER {card.er}</span>
      </div>

      {(card.state === 'failed' || card.state === 'unavailable') && (
        <p className="text-xs text-[var(--down)]">{card.message}</p>
      )}

      <div className="flex gap-2 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
        {(card.canSync || card.canRetry) && (
          <button
            type="button"
            onClick={() => onSync(card.id)}
            className="rounded-lg border border-[var(--border)] bg-white px-2 py-1 text-xs hover:bg-[var(--accent-soft)]"
          >
            {card.canRetry ? 'Повторить' : 'Обновить'}
          </button>
        )}

        <button
          type="button"
          onClick={() => onDelete(card.id)}
          className="rounded-lg border border-[var(--border)] bg-white px-2 py-1 text-xs hover:bg-[var(--down)]/10"
        >
          Удалить
        </button>
      </div>
    </article>
  )
}
