import type { ReactNode } from 'react'

/**
 * Общая рамка графика: заголовок, необязательная подсказка и либо содержимое,
 * либо честное пустое состояние.
 *
 * Серверный компонент. Клиентским здесь становится только сам график внутри —
 * рамке считать нечего, и тащить её в бандл вместе с Recharts незачем.
 *
 * Пустое состояние — не «нет данных», а объяснение, что делать. У блогера,
 * который завёл кабинет пять минут назад, снапшотов ещё нет; он должен понять,
 * что это нормально и надо подождать, а не решить, что сервис сломался.
 */
export function ChartFrame({
  title,
  hint,
  empty,
  emptyText,
  action,
  children,
}: {
  title: string
  hint?: string
  empty: boolean
  emptyText: string
  /** Переключатель диапазона и подобное — встаёт справа от заголовка. */
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="flex flex-col gap-4 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--shadow)] sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-base font-semibold">{title}</h2>
          {hint && <p className="text-xs text-[var(--muted)]">{hint}</p>}
        </div>
        {action}
      </div>

      {empty ? (
        <p className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface-2)] px-4 py-10 text-center text-sm text-[var(--muted)]">
          {emptyText}
        </p>
      ) : (
        children
      )}
    </section>
  )
}
