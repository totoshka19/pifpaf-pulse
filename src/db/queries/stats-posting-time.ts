import { sql } from 'drizzle-orm'
import { db } from '@/db'
import { MOSCOW_TZ } from '@/lib/time/moscow'
import { rowsOf, toNumber } from './coerce'

export type PostingSlot = {
  /** 1 — понедельник … 7 — воскресенье, по МСК. */
  weekday: number
  /** 0…23 по МСК. */
  hour: number
  reelsCount: number
  /** `null` — рилсы в слоте есть, а просмотров ни у одного нет. */
  avgViews: number | null
}

/**
 * Гистограмма «когда лучше постить»: сколько рилсов и какие у них просмотры
 * в каждом слоте «день недели × час публикации».
 *
 * ЗДЕСЬ ПОЯС РЕШАЕТ ВСЁ. `posted_at` — это `TIMESTAMPTZ`, физически хранимый
 * в UTC. `EXTRACT(HOUR FROM posted_at)` без `AT TIME ZONE` вернёт час по
 * Гринвичу: вечерняя публикация в 20:30 МСК встанет в столбик 17:00, весь
 * пик уедет на три часа влево, и совет «постить в пять вечера» будет ложью.
 * PLAN.md §8 предупреждает об этом прямо.
 *
 * Считается по `posted_at` — времени ПУБЛИКАЦИИ, а не опроса. Вопрос
 * гистограммы «когда выкладывать», а не «когда мы сходили в Apify».
 *
 * `ISODOW`, а не `DOW`: у `DOW` воскресенье равно нулю, и неделя начинается
 * не с того дня, с которого её читает человек. `ISODOW` даёт 1…7 от
 * понедельника — то же, что подписи на оси.
 *
 * Просмотры берутся из ПОСЛЕДНЕГО снапшота каждого рилса тем же `DISTINCT ON`,
 * что и в остальных запросах среза: складывать историю значило бы считать
 * один рилс столько раз, сколько его опрашивали.
 */
export async function statsPostingTime(userId: string): Promise<PostingSlot[]> {
  const result = await db.execute(sql`
    WITH latest AS (
      -- Последний снапшот каждого рилса. LEFT JOIN: опубликованный, но ещё
      -- не опрошенный рилс обязан попасть в счёт слота — просто без просмотров.
      SELECT DISTINCT ON (r.id)
             r.id,
             r.posted_at,
             s.views
      FROM reels r
      LEFT JOIN reel_snapshots s ON s.reel_id = r.id
      -- Рилс в статусе pending даты публикации ещё не имеет: ставить его
      -- в слот некуда, и гистограмме он не нужен.
      WHERE r.user_id = ${userId}
        AND r.posted_at IS NOT NULL
      ORDER BY r.id, s.captured_at DESC
    )
    SELECT
      EXTRACT(ISODOW FROM (posted_at AT TIME ZONE ${MOSCOW_TZ}::text))::int AS weekday,
      EXTRACT(HOUR   FROM (posted_at AT TIME ZONE ${MOSCOW_TZ}::text))::int AS hour,
      count(*)                                                             AS reels_count,
      -- AVG по пустому множеству — NULL, и это правильный ответ: среднего
      -- нет, а не «ноль просмотров».
      ROUND(AVG(views))                                                    AS avg_views
    FROM latest
    GROUP BY 1, 2
    ORDER BY 1, 2
  `)

  return rowsOf(result).map((row) => ({
    // ::int в SQL уже сделал из numeric нормальный int4, но приведение здесь
    // всё равно обязательно: count(*) — bigint, ROUND(AVG(...)) — numeric,
    // и оба приходят строкой. См. таблицу типов в coerce.ts.
    weekday: toNumber(row.weekday) ?? 0,
    hour: toNumber(row.hour) ?? 0,
    reelsCount: toNumber(row.reels_count) ?? 0,
    avgViews: toNumber(row.avg_views),
  }))
}
