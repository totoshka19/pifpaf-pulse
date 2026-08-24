'use client'

import type { ReelCardModel } from '@/lib/reels/view-model'
import { ReelCard } from './reel-card'

type Props = {
  cards: ReelCardModel[]
  highlighted: string | null
  onSync: (id: string) => void
  onDelete: (id: string) => void
}

export function ReelsGrid({ cards, highlighted, onSync, onDelete }: Props) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
      {cards.map((card, index) => (
        <ReelCard
          key={card.id}
          card={card}
          highlighted={highlighted === card.id}
          // Первый экран (до восьми карточек) — сразу, остальное лениво:
          // лента из двадцати обложек весит около мегабайта, замер среза 4.
          priority={index < 8}
          onSync={onSync}
          onDelete={onDelete}
        />
      ))}
    </div>
  )
}
