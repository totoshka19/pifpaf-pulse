import { plural } from '@/lib/format/plural'

/**
 * Троттлинг кнопки «Обновить», PLAN.md §7.
 *
 * Ограничение не техническое, а денежное: каждый прогон стоит результат из
 * месячного лимита Apify, а Instagram всё равно не пересчитывает счётчики
 * чаще. Без троттлинга достаточно одного блогера, залипшего на кнопке,
 * чтобы бюджет кончился за вечер.
 *
 * Считаем именно ПОПЫТКИ, а не успехи: неудачный прогон списывает с месячного
 * лимита ровно тот же результат, что и удачный, — Apify берёт за сам прогон,
 * а не за то, что он что-то нашёл. Поэтому вход — время последней попытки,
 * а не время последнего успеха. Если считать только успехи, кнопка
 * «Повторить» у рилсов в статусе failed не троттлится вообще никогда —
 * ровно для них ограничение и задумывалось.
 */

export const MANUAL_SYNC_COOLDOWN_MS = 3_600_000

export type ThrottleVerdict = { allowed: true } | { allowed: false; message: string }

export function checkManualSync(lastAttemptAt: Date | null, now: Date): ThrottleVerdict {
  if (!lastAttemptAt) return { allowed: true }

  const passed = now.getTime() - lastAttemptAt.getTime()

  // Отрицательная разница — часы разъехались. Это не повод запрещать на час.
  if (passed < 0 || passed >= MANUAL_SYNC_COOLDOWN_MS) return { allowed: true }

  const left = Math.max(1, Math.ceil((MANUAL_SYNC_COOLDOWN_MS - passed) / 60_000))

  return {
    allowed: false,
    message:
      'Обновляли совсем недавно. Instagram пересчитывает счётчики не чаще ' +
      `раза в час — загляни через ${left} ${plural(left, ['минуту', 'минуты', 'минут'])}`,
  }
}
