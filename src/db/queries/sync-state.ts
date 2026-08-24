import { and, desc, eq } from 'drizzle-orm'
import { db, syncRuns } from '@/db'

/**
 * Время последней попытки синхронизации по СТАБИЛЬНОЙ паре
 * «пользователь + шорткод».
 *
 * Почему не по `reel_id`. Пара `(user_id, shortcode)` — настоящая идентичность
 * копии рилса у блогера: в `reels` на ней стоит `uq_reels_user_shortcode`.
 * Она переживает удаление и повторную вставку, а `reel_id` — нет. Именно на
 * этом держалась дыра, задокументированная с среза 5: удалить рилс и вставить
 * ту же ссылку заново значило обойти часовой троттлинг и потратить лишний
 * кредит Apify. Каждый цикл — минус кредит.
 *
 * Считаются ПОПЫТКИ, а не успехи (см. `checkManualSync`): проваленный прогон
 * списывает тот же результат из месячного лимита, что и удачный.
 */
export async function lastAttemptFor(
  userId: string,
  shortcode: string,
): Promise<Date | null> {
  const [row] = await db
    .select({ startedAt: syncRuns.startedAt })
    .from(syncRuns)
    .where(and(eq(syncRuns.userId, userId), eq(syncRuns.shortcode, shortcode)))
    .orderBy(desc(syncRuns.startedAt))
    .limit(1)

  return row?.startedAt ?? null
}
