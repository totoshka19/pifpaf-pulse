'use client'

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { ChartPoint } from '@/lib/stats/chart-data'

/**
 * График суммарных просмотров по дням.
 *
 * Клиентский — этого требует Recharts. Но ничего НЕ СЧИТАЕТ и НЕ ФОРМАТИРУЕТ:
 * `label` и `title` приходят готовыми строками с сервера. Дать Recharts
 * отформатировать дату заново значит потерять московский пояс, ради которого
 * написан весь SQL, на самом последнем шаге.
 *
 * Цвета — через CSS-переменные проекта, не литералами: подстановка внутрь SVG
 * Recharts работает (проверено спайком задачи 1), и тёмная тема среза 8
 * подхватит их даром.
 */

/** Показываем не каждую подпись: на 30 днях они сливаются в кашу. */
function tickInterval(count: number): number {
  if (count <= 8) return 0
  return Math.ceil(count / 6) - 1
}

function ViewsTooltip({
  active,
  payload,
}: {
  active?: boolean
  payload?: { payload: ChartPoint }[]
}) {
  if (!active || !payload?.length) return null

  const point = payload[0].payload

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs shadow-[var(--shadow)]">
      <p className="text-[var(--muted)]">{point.label}</p>
      {/* Точное число, а не сокращённое: тултип для того и открывают. */}
      <p className="text-sm font-semibold tabular-nums">{point.title}</p>
      <p className="text-[var(--muted)]">просмотров всего</p>
    </div>
  )
}

export function ViewsChart({ points }: { points: ChartPoint[] }) {
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="viewsFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.28} />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity={0.02} />
            </linearGradient>
          </defs>

          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />

          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            interval={tickInterval(points.length)}
            tick={{ fontSize: 11, fill: 'var(--muted)' }}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={44}
            tick={{ fontSize: 11, fill: 'var(--muted)' }}
            // Ось подписываем коротко: полные «15 077 080» съели бы треть
            // ширины на телефоне. Точное число живёт в тултипе.
            tickFormatter={(value: number) =>
              value >= 1_000_000
                ? `${Math.round(value / 100_000) / 10}M`
                : value >= 1000
                  ? `${Math.round(value / 1000)}K`
                  : String(value)
            }
          />

          <Tooltip content={<ViewsTooltip />} cursor={{ stroke: 'var(--accent)' }} />

          <Area
            type="monotone"
            dataKey="value"
            stroke="var(--accent)"
            strokeWidth={2}
            fill="url(#viewsFill)"
            // Точки рисуем только когда их мало: на 30 днях они сливаются
            // в сплошную линию из кружков.
            dot={points.length <= 10}
            // Анимацию гасит prefers-reduced-motion в globals.css, но Recharts
            // рисует её на SVG-атрибутах, куда CSS-правило не достаёт.
            // Задача 14 разбирается с этим отдельно.
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
