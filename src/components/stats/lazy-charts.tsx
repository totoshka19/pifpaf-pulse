'use client'

import dynamic from 'next/dynamic'

/**
 * Ленивая загрузка графиков.
 *
 * Отдельный клиентский модуль, а не опция на месте использования: по
 * документации Next 16 (`docs/01-app/02-guides/lazy-loading.md`) опция
 * `ssr: false` **не поддерживается в серверных компонентах** и бросает
 * ошибку. Страницы дашборда и рилса серверные, поэтому граница клиента
 * проходит здесь.
 *
 * Зачем вообще лениво. Recharts — 331 КБ несжатыми (замер задачи 1), это
 * первая тяжёлая зависимость проекта. Графики лежат ниже первого экрана,
 * и блокировать ими первую краску на телефоне незачем: сверху KPI и топ-3,
 * которые рисуются мгновенно и отвечают на главный вопрос блогера.
 *
 * `ssr: false` здесь ещё и снимает двойную работу: график всё равно
 * перерисовывается на клиенте под реальную ширину контейнера
 * (`ResponsiveContainer`), поэтому серверная разметка SVG была бы выброшена.
 */

/** Заглушка ровно той высоты, что займёт график: страница не должна прыгать. */
function ChartPlaceholder({ height }: { height: string }) {
  return (
    <div
      className={`${height} w-full animate-pulse rounded-xl bg-black/5`}
      // Заглушка — не контент. Скринридеру сообщать о ней нечего.
      aria-hidden
    />
  )
}

export const LazyViewsChart = dynamic(
  () => import('./views-chart').then((m) => m.ViewsChart),
  { ssr: false, loading: () => <ChartPlaceholder height="h-64" /> },
)

export const LazyGrowthChart = dynamic(
  () => import('./growth-chart').then((m) => m.GrowthChart),
  { ssr: false, loading: () => <ChartPlaceholder height="h-64" /> },
)
