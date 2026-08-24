import { sql } from 'drizzle-orm'
import { db } from '@/db'
import { MOSCOW_TZ } from '@/lib/time/moscow'
import { rowsOf, toNumber } from './coerce'

export type TimeseriesRange = '7d' | '30d' | 'all'

/** `day` — уже московский календарный день, строкой «YYYY-MM-DD». */
export type TimeseriesPoint = { day: string; totalViews: number }

const DAYS: Record<TimeseriesRange, number | null> = { '7d': 7, '30d': 30, all: null }

/**
 * Суммарные просмотры по дням для графика динамики.
 *
 * Запрос из PLAN.md §8 содержал две ошибки, обе чинятся здесь.
 *
 * ПЕРВАЯ — двойной счёт. Спека складывала `s.views` по снапшотам. Рилс,
 * опрошенный утром на 1000 и вечером на 1200, давал за день 2200 — число,
 * которого не существует. Свежий рилс опрашивается раз в час (§7), то есть
 * за первые сутки посчитался бы двадцать четыре раза. Лечится
 * `DISTINCT ON (reel_id, день)`: последний снапшот КАЖДОГО рилса за КАЖДЫЙ
 * день, и только потом сложение.
 *
 * ВТОРАЯ — дыры. В день, когда часть рилсов не опрашивалась, сумма
 * проваливалась. Суммарные просмотры убывать не умеют, и такой график
 * читается как сломанный, а дыры при адаптивном расписании §7 неизбежны:
 * месячный рилс опрашивается раз в неделю. Лечится классическим для Postgres
 * приёмом gaps-and-islands: `count()` по возрастанию дней растёт только там,
 * где значение есть, и потому нумерует «острова»; `first_value` внутри
 * острова протягивает последнее известное значение вперёд по дырам.
 *
 * Дни ДО первого снапшота рилса отбрасываются: тянуть назад нечего, и рилс,
 * добавленный вчера, не должен приписывать себе прошлую неделю. Это делает
 * `WHERE views IS NOT NULL` — до первого острова `count()` равен нулю, и
 * `first_value` в этой группе видит только NULL.
 *
 * Календарь МОСКОВСКИЙ на всех трёх уровнях: в группировке, в сетке дней и
 * в границах диапазона. `date_trunc` без `AT TIME ZONE` сдвинул бы сутки
 * на три часа, и вечерний опрос уехал бы в следующий день.
 */
export async function statsTimeseries(
  userId: string,
  range: TimeseriesRange = '30d',
): Promise<TimeseriesPoint[]> {
  const days = DAYS[range]

  /**
   * Московский календарный день снапшота.
   *
   * `MOSCOW_TZ` уходит СВЯЗАННЫМ параметром, а не склейкой строки:
   * `timestamptz AT TIME ZONE $1` Postgres принимает штатно, и дверь для
   * инъекции остаётся закрытой даже для константы.
   */
  const mskDay = sql`(s.captured_at AT TIME ZONE ${MOSCOW_TZ}::text)::date`

  /** Сегодняшний московский день — правая граница сетки. */
  const today = sql`(now() AT TIME ZONE ${MOSCOW_TZ}::text)::date`

  // Левая граница: либо «сегодня минус N дней», либо самый ранний снапшот.
  // Считается в SQL, а не в JS: границей календаря должен быть московский
  // день, а не день часового пояса машины, где выполняется Node.
  const from = days
    ? sql`${today} - ${days - 1}::int`
    : sql`(
        SELECT MIN((s.captured_at AT TIME ZONE ${MOSCOW_TZ}::text)::date)
        FROM reel_snapshots s
        JOIN reels r ON r.id = s.reel_id
        WHERE r.user_id = ${userId}
      )`

  const result = await db.execute(sql`
    WITH bounds AS (
      -- При пустой выборке MIN(...) даёт NULL, и generate_series честно
      -- возвращает ноль строк, а не падает. Проверено тестом на пользователя
      -- без снапшотов в режиме all.
      SELECT generate_series(${from}, ${today}, INTERVAL '1 day')::date AS day
    ),
    per_reel_day AS (
      -- Последний снапшот каждого рилса за каждый московский день.
      --
      -- День считается во ВЛОЖЕННОМ запросе, а DISTINCT ON ссылается уже на
      -- готовый алиас. Это не украшательство: Postgres требует, чтобы
      -- выражения DISTINCT ON совпадали с началом ORDER BY ТЕКСТУАЛЬНО, а
      -- каждая подстановка пояса превращается в отдельный нумерованный
      -- параметр — $2 в одном месте и $5 в другом. Значение то же, номер
      -- другой, и Postgres отвечает «DISTINCT ON expressions must match
      -- initial ORDER BY expressions». Считать день один раз дешевле, чем
      -- склеивать строку запроса ради совпадения текста.
      SELECT DISTINCT ON (reel_id, day)
             reel_id,
             day,
             views
      FROM (
        SELECT s.reel_id,
               ${mskDay} AS day,
               s.views,
               s.captured_at
        FROM reel_snapshots s
        JOIN reels r ON r.id = s.reel_id
        WHERE r.user_id = ${userId}
      ) AS dated
      ORDER BY reel_id, day, captured_at DESC
    ),
    grid AS (
      -- Полная решётка «каждый рилс × каждый день диапазона». Дальше по ней
      -- растекаются известные значения.
      SELECT r.id AS reel_id, b.day
      FROM reels r
      CROSS JOIN bounds b
      WHERE r.user_id = ${userId}
    ),
    islands AS (
      -- count() игнорирует NULL, поэтому счётчик растёт только в дни с данными.
      -- Одинаковый номер = один «остров»: день со значением и все дыры за ним.
      SELECT g.reel_id,
             g.day,
             p.views,
             count(p.views) OVER (PARTITION BY g.reel_id ORDER BY g.day) AS island
      FROM grid g
      LEFT JOIN per_reel_day p ON p.reel_id = g.reel_id AND p.day = g.day
    ),
    carried AS (
      -- Первое значение острова — то самое известное. Оно и протягивается
      -- на все дыры внутри острова.
      SELECT reel_id,
             day,
             first_value(views) OVER (PARTITION BY reel_id, island ORDER BY day) AS views
      FROM islands
    )
    SELECT to_char(day, 'YYYY-MM-DD') AS day,
           SUM(views)                 AS total_views
    FROM carried
    -- Остров №0 — дни до первого снапшота рилса. Тянуть назад нечего.
    WHERE views IS NOT NULL
    GROUP BY day
    ORDER BY day
  `)

  return rowsOf(result).map((row) => ({
    day: String(row.day),
    // SUM по BIGINT — снова строка. См. таблицу типов в coerce.ts.
    totalViews: toNumber(row.total_views) ?? 0,
  }))
}
