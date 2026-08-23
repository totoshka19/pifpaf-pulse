/**
 * Расчёт периода и лимита расхода Apify. Чистые функции, без базы.
 *
 * Работа со счётчиком — в `src/db/queries/budget.ts`: там нужен `@/db`, который
 * бросает исключение при импорте без `DATABASE_URL`, и утянул бы за собой
 * эти функции в нетестируемое состояние.
 *
 * Free tier: $5/мес ÷ $2.70 за 1000 результатов ≈ 1850 синхронизаций (PLAN.md §1).
 * В ТЗ прямо сказано «бесплатки хватит» — выход за лимит это провал условия задачи.
 */

/** Ниже реального потолка 1850: буфер на повторы после ошибок актора. */
const DEFAULT_CAP = 1500

const MSK_OFFSET_MS = 3 * 3_600_000

/**
 * Ключ периода `YYYY-MM` в московском времени.
 *
 * По UTC месяц переключался бы в 03:00 МСК — и расход последних трёх часов
 * августа лёг бы в сентябрьский счётчик. Мелочь, но она искажает единственную
 * цифру, по которой мы судим об остатке бюджета.
 */
export function currentPeriod(now: Date): string {
  const msk = new Date(now.getTime() + MSK_OFFSET_MS)
  const month = String(msk.getUTCMonth() + 1).padStart(2, '0')
  return `${msk.getUTCFullYear()}-${month}`
}

export function monthlyCap(): number {
  const parsed = Number.parseInt(process.env.APIFY_MONTHLY_CAP ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_CAP
}
