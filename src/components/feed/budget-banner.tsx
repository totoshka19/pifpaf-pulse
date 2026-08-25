import { usage } from '@/db/queries/budget'
import { budgetNotice } from '@/lib/budget/notice'

/**
 * Плашка «лимит обновлений на этот месяц исчерпан».
 *
 * Зачем она есть. Механика лимита работает с среза 7 и честно отдаёт
 * `skipped: 'budget'` в отчёте крона — но блогер этого отчёта не видит. Без
 * плашки исчерпанный лимит выглядит для него как поломка: цифры просто
 * перестали меняться, и непонятно, ждать или жаловаться.
 *
 * Компонент серверный и сам ходит за `usage()`: это одна дешёвая выборка по
 * первичному ключу, и тащить её через пропы из страницы значило бы связать
 * страницу со знанием о бюджете ради данных, которые нужны только здесь.
 *
 * Решение «показывать или молчать» живёт не тут, а в `budgetNotice`
 * (src/lib/budget/notice.ts) — там оно покрыто тестами, включая переход
 * счётчика через границу года.
 */
export async function BudgetBanner() {
  const notice = budgetNotice(await usage())

  if (!notice) return null

  return (
    <div
      role="status"
      className="mb-6 flex flex-col gap-1 rounded-[var(--radius)] border-l-4 border-[var(--accent)] bg-[var(--accent-soft)] px-5 py-4"
    >
      <p className="font-medium text-[var(--ink)]">{notice.headline}</p>
      <p className="text-sm text-[var(--muted)]">{notice.detail}</p>
    </div>
  )
}
