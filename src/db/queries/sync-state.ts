import { and, count, desc, eq, gte } from 'drizzle-orm'
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
 *
 * НЕ фильтрует по `triggered_by` — и это осознанно, а не недосмотр. Прогон
 * крона учитывается наравне с ручным: кредит Apify потрачен независимо от
 * того, кто дёрнул прогон, а часовой троттлинг этой функции защищает именно
 * бюджет, не только терпение пользователя, жмущего кнопку. Поэтому тик крона
 * по рилсу законно блокирует пользователю его собственное «Обновить» на этот
 * же час — не путать с доккомментом колонки `triggered_by` в `schema.ts`,
 * который объясняет НАЗНАЧЕНИЕ колонки (не путать крон с пользователем при
 * подсчёте лимита на пользователя), а не то, что крон нигде не считается.
 * Фильтр `triggered_by = 'manual'` нужен только отдельному лимиту
 * «N попыток в минуту НА ПОЛЬЗОВАТЕЛЯ» — см. `manualAttemptsSince` ниже —
 * здесь его нет и быть не должно.
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

/**
 * Сколько РУЧНЫХ попыток пользователь сделал начиная с момента `since`.
 *
 * `triggered_by = 'manual'` — не украшение. Без него тик крона, тронувший
 * десять рилсов блогера, засчитался бы как десять его попыток и заблокировал
 * бы ему кнопку при том, что он ничего не нажимал.
 *
 * Считается по `user_id`, а не через JOIN к `reels`: строка переживает
 * удаление рилса, и счётчик вместе с ней. Иначе лимит обнулялся бы тем же
 * действием, от которого защищает.
 */
export async function manualAttemptsSince(userId: string, since: Date): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(syncRuns)
    .where(
      and(
        eq(syncRuns.userId, userId),
        eq(syncRuns.triggeredBy, 'manual'),
        gte(syncRuns.startedAt, since),
      ),
    )

  return row?.n ?? 0
}
