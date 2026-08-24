'use client'

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { ChartPoint } from '@/lib/stats/chart-data'

/**
 * Рост просмотров одного рилса по снапшотам.
 *
 * ЭТОТ ГРАФИК ПРОДАЁТ ВСЮ ИДЕЮ. Он единственное место в сервисе, где видно,
 * что данные действительно обновляются: не один слепок, а цепочка замеров
 * во времени. Ради него в схеме и лежит `reel_snapshots` отдельной таблицей.
 *
 * Линия, а не область: здесь важна форма кривой (набрал сразу или разгоняется),
 * а не «объём под ней».
 */

function GrowthTooltip({
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
      <p className="text-sm font-semibold tabular-nums">{point.title}</p>
      <p className="text-[var(--muted)]">просмотров</p>
    </div>
  )
}

export function GrowthChart({ points }: { points: ChartPoint[] }) {
  return (
    // aria-hidden: числа скринридер получает из <ChartTable> рядом,
    // а внутренности SVG прочитались бы поверх неё бессмысленным шумом.
    <div className="h-64 w-full" aria-hidden>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ top: 8, right: 20, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />

          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            // Показываем только края: подписи с часами длинные и на десяти
            // замерах наезжают друг на друга.
            interval="preserveStartEnd"
            minTickGap={48}
            tick={{ fontSize: 11, fill: 'var(--muted)' }}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={44}
            tick={{ fontSize: 11, fill: 'var(--muted)' }}
            // Ось НЕ начинаем с нуля: у рилса с миллионом просмотров рост
            // за неделю на этом фоне выглядел бы прямой линией. Точное
            // значение всегда есть в тултипе.
            domain={['dataMin', 'dataMax']}
            tickFormatter={(value: number) =>
              value >= 1_000_000
                ? `${Math.round(value / 100_000) / 10}M`
                : value >= 1000
                  ? `${Math.round(value / 1000)}K`
                  : String(value)
            }
          />

          <Tooltip content={<GrowthTooltip />} cursor={{ stroke: 'var(--accent)' }} />

          <Line
            type="monotone"
            dataKey="value"
            stroke="var(--accent)"
            strokeWidth={2}
            dot={{ r: 3, fill: 'var(--accent)' }}
            activeDot={{ r: 5 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
