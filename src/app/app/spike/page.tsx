import { SpikeChart } from '@/components/stats/spike-chart'

/**
 * ВРЕМЕННАЯ страница разведки: удаляется в задаче 8 среза 6.
 * Существует только чтобы посмотреть на Recharts глазами и в браузерной консоли.
 */
export default function SpikePage() {
  return (
    <section className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--shadow)] sm:p-6">
      <h1 className="mb-4 text-lg font-semibold">Спайк Recharts</h1>
      <SpikeChart />
    </section>
  )
}
