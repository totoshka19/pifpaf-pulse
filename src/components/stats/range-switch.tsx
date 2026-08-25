import Link from 'next/link'
import type { TimeseriesRange } from '@/db/queries/stats-timeseries'

/**
 * Переключатель диапазона графика: 7 дней / 30 дней / всё время.
 *
 * Обычные ССЫЛКИ, а не кнопки с состоянием. Диапазон живёт в URL, серверный
 * компонент и так перечитывает данные при смене параметра, и клиентского
 * состояния здесь не заводится вовсе. Побочные выгоды: ссылку на «за всё
 * время» можно отправить себе в заметки, а Назад в браузере работает
 * как ожидается.
 *
 * Серверный компонент — рисует три ссылки, считать нечего.
 */

const OPTIONS: { value: TimeseriesRange; label: string; full: string }[] = [
  { value: '7d', label: '7д', full: 'за 7 дней' },
  { value: '30d', label: '30д', full: 'за 30 дней' },
  { value: 'all', label: 'всё', full: 'за всё время' },
]

export function RangeSwitch({ current }: { current: TimeseriesRange }) {
  return (
    <div className="flex items-center gap-1 rounded-full bg-[var(--chip)] p-0.5" role="group" aria-label="Диапазон графика">
      {OPTIONS.map((option) => {
        const active = option.value === current

        return (
          <Link
            key={option.value}
            href={`/app?range=${option.value}`}
            // Мягкая прокрутка вверх при смене диапазона не нужна: график
            // стоит посреди страницы, и прыжок к шапке сбивает.
            scroll={false}
            aria-current={active ? 'true' : undefined}
            // Подпись для скринридера полная: «7д» вслух звучит как мусор.
            aria-label={option.full}
            className={`rounded-full px-2.5 py-1 text-xs transition-colors ${
              active
                ? 'bg-[var(--surface)] font-medium text-[var(--ink)] shadow-sm'
                : 'text-[var(--muted)] hover:text-[var(--ink)]'
            }`}
          >
            {option.label}
          </Link>
        )
      })}
    </div>
  )
}
