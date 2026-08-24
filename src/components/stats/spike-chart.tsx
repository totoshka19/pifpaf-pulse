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

/**
 * ВРЕМЕННЫЙ компонент разведки: удаляется в задаче 8 среза 6.
 *
 * Цель — не красота, а ответ на вопрос «Recharts вообще собирается и рисуется
 * на React 19 и Next 16». Данные прибиты гвоздями намеренно: спайк не должен
 * зависеть ни от базы, ни от сессии.
 */
const POINTS = [
  { day: '18.08', views: 1200 },
  { day: '19.08', views: 1850 },
  { day: '20.08', views: 2400 },
  { day: '21.08', views: 2410 },
  { day: '22.08', views: 3900 },
]

export function SpikeChart() {
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={POINTS} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis dataKey="day" tickLine={false} axisLine={false} />
          <YAxis tickLine={false} axisLine={false} width={48} />
          <Tooltip />
          <Area
            type="monotone"
            dataKey="views"
            stroke="var(--accent)"
            fill="var(--accent-soft)"
            strokeWidth={2}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
