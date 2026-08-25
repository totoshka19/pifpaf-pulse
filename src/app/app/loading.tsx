/**
 * Скелетон дашборда.
 *
 * Заглушки той же высоты, что займут настоящие блоки: строка KPI, два графика
 * и топ-3. Иначе страница «прыгает» в момент, когда данные доезжают, — а на
 * холодной базе Neon этот момент наступает через секунду-другую, и прыжок
 * успевают увидеть.
 *
 * Пульсация выключается для тех, кто попросил систему уменьшить движение:
 * правило `prefers-reduced-motion` уже стоит в `globals.css` и гасит
 * `animate-pulse` глобально.
 */
export default function Loading() {
  return (
    <div className="flex animate-pulse flex-col gap-6">
      <div className="flex flex-col gap-2">
        <div className="h-8 w-40 rounded-lg bg-[var(--surface-2)]" />
        <div className="h-4 w-64 rounded bg-[var(--surface-2)]" />
      </div>

      {/* Строка KPI: пять плиток, на узком экране в два столбца. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="h-24 rounded-[var(--radius)] bg-[var(--surface-2)]" />
        ))}
      </div>

      <div className="h-72 rounded-[var(--radius)] bg-[var(--surface-2)]" />
      <div className="h-72 rounded-[var(--radius)] bg-[var(--surface-2)]" />
    </div>
  )
}
