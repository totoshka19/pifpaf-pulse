/**
 * Расписание опроса рилсов в статусе pending.
 *
 * Прогон Apify идёт 14–19 секунд (замер среза 3), поэтому первые попытки
 * частые. Дальше интервал растёт: карточка, застрявшая в pending, не должна
 * дёргать функции Netlify раз в две секунды до закрытия вкладки — на free tier
 * это расход лимита исполнений впустую.
 *
 * Суммарно лестница даёт около пяти минут ожидания, после чего опрос
 * прекращается и карточка предлагает повторить вручную.
 */

export const POLL_MAX_ATTEMPTS = 40

/** [номер попытки, до которого действует ступень; задержка в мс] */
const LADDER: readonly (readonly [maxAttempt: number, delayMs: number])[] = [
  [10, 2_000],
  [20, 4_000],
  [30, 8_000],
  [Infinity, 15_000],
] as const

export function nextPollDelay(attempt: number): number {
  return LADDER.find(([maxAttempt]) => attempt < maxAttempt)![1]
}

export function shouldKeepPolling(attempt: number, pendingCount: number): boolean {
  return pendingCount > 0 && attempt < POLL_MAX_ATTEMPTS
}
