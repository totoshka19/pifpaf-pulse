/** Пульсирующие заглушки под сетку. Пропорция та же 9:16, что у обложек. */
export function GridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="flex flex-col gap-2">
          <div className="aspect-9/16 animate-pulse rounded-[var(--radius)] bg-[var(--surface-2)]" />
          <div className="h-4 w-2/3 animate-pulse rounded bg-[var(--surface-2)]" />
        </div>
      ))}
    </div>
  )
}
