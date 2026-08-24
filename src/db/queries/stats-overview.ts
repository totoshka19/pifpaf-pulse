import { sql } from 'drizzle-orm'
import { db } from '@/db'
import { rowsOf, toNumber } from './coerce'

export type StatsOverview = {
  /** Сколько рилсов в кабинете. Настоящий ноль, а не «нет данных». */
  reelsCount: number
  /** Сумма последних известных просмотров. `null` — складывать нечего. */
  totalViews: number | null
  /** Среднее на рилс. `null` по той же причине. */
  avgViews: number | null
  /** (лайки + комментарии) / просмотры, в процентах. `null` — считать не из чего. */
  erPercent: number | null
  /** Прирост просмотров за 7 дней по всем рилсам. `null` — точек мало. */
  growth7d: number | null
}

/**
 * Верхняя строка дашборда: пять чисел про кабинет целиком.
 *
 * ГЛАВНОЕ РЕШЕНИЕ ЗАПРОСА — суммировать ПОСЛЕДНИЕ снапшоты, а не все.
 * Наивное `SUM(s.views)` по всей таблице складывает историю: рилс,
 * опрошенный утром на 1000 просмотров и вечером на 1200, дал бы 2200 —
 * число, которого никогда не существовало. Свежий рилс опрашивается раз
 * в час (PLAN.md §7), то есть за первые сутки посчитался бы двадцать
 * четыре раза. Поэтому `DISTINCT ON` — по одной, самой свежей строке
 * на рилс, и только потом сложение.
 *
 * Тот же приём и тот же индекс `idx_snapshots_reel_ts`, что в `listReels`.
 *
 * `LEFT JOIN`, а не `JOIN`: рилс без снапшотов обязан попасть в `reels_count`.
 * Только что добавленная ссылка ещё не опрошена, но она уже есть, и написать
 * блогеру «рилсов: 0» сразу после добавления значило бы соврать.
 *
 * Про «нет данных». `SUM` и `AVG` в Postgres возвращают NULL на пустой
 * выборке — и это ровно то поведение, которое здесь нужно, поэтому никакого
 * `COALESCE(..., 0)` в запросе нет. Ноль просмотров и отсутствие просмотров
 * — разные вещи: первое рисуется как «0», второе как «—».
 */
export async function statsOverview(userId: string): Promise<StatsOverview> {
  const result = await db.execute(sql`
    WITH latest AS (
      -- По одной строке на рилс — самой свежей. Рилс без снапшотов остаётся
      -- в выборке со всеми метриками NULL: он существует, но данных нет.
      SELECT DISTINCT ON (r.id)
             r.id,
             s.views,
             s.likes,
             s.comments
      FROM reels r
      LEFT JOIN reel_snapshots s ON s.reel_id = r.id
      WHERE r.user_id = ${userId}
      ORDER BY r.id, s.captured_at DESC
    ),
    ranked AS (
      -- Прирост за неделю. Оконные функции считаются за ОДИН проход:
      -- нумерация от свежих, нумерация от старых и размер группы сразу.
      SELECT s.reel_id,
             s.views,
             ROW_NUMBER() OVER (PARTITION BY s.reel_id ORDER BY s.captured_at DESC) AS rn_new,
             ROW_NUMBER() OVER (PARTITION BY s.reel_id ORDER BY s.captured_at ASC)  AS rn_old,
             COUNT(*)     OVER (PARTITION BY s.reel_id)                             AS points
      FROM reel_snapshots s
      JOIN reels r ON r.id = s.reel_id
      WHERE r.user_id = ${userId}
        AND s.captured_at > now() - INTERVAL '7 days'
    ),
    growth AS (
      -- Сумма приростов по рилсам. SUM пропускает NULL, поэтому рилс без
      -- честной разницы не вносит ноль — он просто не участвует. Если честной
      -- разницы нет ни у одного, SUM вернёт NULL, и дашборд напишет «—».
      SELECT SUM(delta) AS growth_7d
      FROM (
        SELECT
          -- Без CASE рилс с единственной точкой в окне дал бы rn_new = rn_old = 1,
          -- то есть прирост 0, и дашборд написал бы «+0» там, где честный ответ
          -- — «данных пока мало». PLAN.md §8.
          CASE WHEN MAX(points) > 1
               THEN MAX(views) FILTER (WHERE rn_new = 1)
                  - MAX(views) FILTER (WHERE rn_old = 1)
          END AS delta
        FROM ranked
        GROUP BY reel_id
      ) AS per_reel
    )
    SELECT (SELECT count(*) FROM latest)                       AS reels_count,
           (SELECT SUM(views) FROM latest)                     AS total_views,
           (SELECT ROUND(AVG(views)) FROM latest)              AS avg_views,
           (SELECT ROUND(
                     100.0 * SUM(likes + comments)
                     -- NULLIF спасает от деления на ноль: у блогера с рилсом
                     -- на нуле просмотров без него весь запрос упал бы.
                     / NULLIF(SUM(views), 0), 1)
              FROM latest)                                     AS er_percent,
           (SELECT growth_7d FROM growth)                      AS growth_7d
  `)

  const [row] = rowsOf(result)

  return {
    // count(*) — bigint, то есть строка. Ноль рилсов это настоящий ноль,
    // поэтому здесь единственное место, где null сворачивается в 0.
    reelsCount: toNumber(row?.reels_count) ?? 0,
    totalViews: toNumber(row?.total_views),
    avgViews: toNumber(row?.avg_views),
    erPercent: toNumber(row?.er_percent),
    growth7d: toNumber(row?.growth_7d),
  }
}
