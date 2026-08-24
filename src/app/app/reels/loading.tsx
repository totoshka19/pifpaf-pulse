import { GridSkeleton } from '@/components/feed/skeleton'

/**
 * Показывается, пока стримится страница. Скелетон, а не спиннер: он занимает
 * ровно то место, куда встанут карточки, и лента не «прыгает» при появлении.
 */
export default function Loading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="h-14 animate-pulse rounded-[var(--radius)] bg-white/60" />
      <GridSkeleton />
    </div>
  )
}
