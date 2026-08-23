import { eq, sql } from 'drizzle-orm'
import { apifyUsage, db } from '@/db'
import { currentPeriod, monthlyCap } from '@/lib/apify/budget'

/**
 * Счётчик расхода Apify. Предохранитель из PLAN.md §7.
 *
 * Одного адаптивного расписания мало: ошибка в выборке крона за ночь сожжёт
 * месячный лимит, и сайт встанет ровно тогда, когда его откроет проверяющий.
 */

export type Usage = { period: string; used: number; cap: number; left: number }

/**
 * Атомарно резервирует `count` результатов. `false` — не влезает в лимит.
 *
 * Проверка и инкремент — ОДНИМ запросом. Прочитать значение, сравнить в JS
 * и потом записать нельзя: два параллельных добавления рилса прочитают одно
 * и то же число и оба решат, что бюджет есть. Условие живёт в `WHERE` при
 * `ON CONFLICT DO UPDATE`, поэтому арбитром выступает база, а не приложение.
 */
export async function tryReserve(count: number, now = new Date()): Promise<boolean> {
  const cap = monthlyCap()

  // Первая вставка в новом периоде идёт по ветке без ON CONFLICT, и WHERE к ней
  // не применяется — поэтому запрос заведомо непроходного размера отсекаем здесь.
  if (count <= 0 || count > cap) return false

  const period = currentPeriod(now)

  const result = await db.execute(sql`
    INSERT INTO apify_usage (period, results, updated_at)
    VALUES (${period}, ${count}, now())
    ON CONFLICT (period) DO UPDATE
      SET results = apify_usage.results + ${count},
          updated_at = now()
      WHERE apify_usage.results + ${count} <= ${cap}
    RETURNING results
  `)

  // Пустой результат = условие WHERE не выполнилось = лимит исчерпан.
  const rows = Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? [])
  return rows.length > 0
}

export async function usage(now = new Date()): Promise<Usage> {
  const period = currentPeriod(now)
  const cap = monthlyCap()

  const [row] = await db.select().from(apifyUsage).where(eq(apifyUsage.period, period))
  const used = row?.results ?? 0

  return { period, used, cap, left: Math.max(0, cap - used) }
}
