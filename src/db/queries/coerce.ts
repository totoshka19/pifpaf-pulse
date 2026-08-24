/**
 * Приведение типов на выходе сырого `db.execute`.
 *
 * Общий модуль, а не копия в каждом запросе: срез 6 добавил четыре
 * аналитических запроса, и четыре копии `toNumber` разъехались бы к первой
 * же правке. Поведение драйвера одно на всех — значит и код один.
 *
 * Замер 2026-08-24 на живой базе Neon (postgres.js), сырой `db.execute`:
 *
 *   int (int4)   → число
 *   bigint       → СТРОКА
 *   numeric      → СТРОКА
 *   timestamptz  → СТРОКА в текстовом формате Postgres, «2026-08-24 00:38:00+00»
 *   bool         → boolean
 *   text / uuid  → строка
 *   NULL         → null
 *
 * Типизированный путь `db.select().from(...)` применяет собственный маппер
 * и не расходится. Расходится ровно сырой путь — то есть тот, которым в этом
 * проекте написаны все аналитические запросы.
 */

/**
 * BIGINT и NUMERIC приходят строкой.
 *
 * Драйвер поступает так намеренно: int8 вмещает больше Number.MAX_SAFE_INTEGER,
 * и молчаливая потеря точности хуже строки. Number() здесь безопасен: самый
 * просматриваемый рилс в выгрузке — 14 123 499, до 2^53 запас в шесть порядков.
 */
export function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null

  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * TIMESTAMPTZ приходит строкой, а не объектом Date.
 *
 * Цена пропущенного приведения замерена в срезе 5: карточка молча показывала
 * «—» вместо даты, а лента из двух и более рилсов падала с TypeError
 * («a.createdAt.getTime is not a function») при первом же рендере. С одним
 * рилсом баг невидим — `Array.prototype.sort` не зовёт компаратор.
 */
export function toDate(value: unknown): Date | null {
  if (value === null || value === undefined) return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value

  const parsed = new Date(value as string)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

/**
 * Строки результата сырого запроса.
 *
 * `db.execute` возвращает то массив, то объект с полем `rows` — зависит от
 * драйвера и версии. Разбирать это в каждом запросе незачем.
 */
export function rowsOf(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[]

  return ((result as { rows?: unknown[] })?.rows ?? []) as Record<string, unknown>[]
}
