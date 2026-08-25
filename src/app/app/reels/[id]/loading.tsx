/**
 * Скелетон экрана рилса: обложка, метрики, график и лог той же высоты,
 * что займут настоящие. Иначе страница прыгает в момент, когда данные
 * доезжают, — а на холодной базе Neon это через секунду-другую.
 */
export default function Loading() {
  return (
    <div className="flex animate-pulse flex-col gap-6">
      <div className="h-4 w-20 rounded bg-[var(--surface-2)]" />

      <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
        <div className="aspect-[9/16] w-40 shrink-0 self-center rounded-[var(--radius)] bg-[var(--surface-2)] sm:self-start" />

        <div className="flex flex-1 flex-col gap-4">
          <div className="h-6 w-3/4 rounded bg-[var(--surface-2)]" />
          <div className="h-4 w-40 rounded bg-[var(--surface-2)]" />

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="h-12 rounded bg-[var(--surface-2)]" />
            ))}
          </div>

          <div className="h-10 w-36 rounded-xl bg-[var(--surface-2)]" />
        </div>
      </div>

      <div className="h-80 rounded-[var(--radius)] bg-[var(--surface-2)]" />
      <div className="h-40 rounded-[var(--radius)] bg-[var(--surface-2)]" />
    </div>
  )
}
