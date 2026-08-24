import { sql } from 'drizzle-orm'
import { db } from '@/db'

export type ReelSort = 'added' | 'date' | 'views' | 'growth'

export type ReelListRow = {
  id: string
  shortcode: string
  url: string
  caption: string | null
  ownerUsername: string | null
  thumbnailSrc: string | null
  postedAt: Date | null
  syncStatus: string
  syncError: string | null
  lastSyncedAt: Date | null
  views: number | null
  likes: number | null
  comments: number | null
  capturedAt: Date | null
  createdAt: Date
  /** Прирост просмотров за 7 дней. `null` — точек в окне меньше двух. */
  growth7d: number | null
}

/**
 * BIGINT приходит из postgres.js СТРОКОЙ.
 *
 * Замер 2026-08-24 на живой базе: `SELECT 1234::bigint` даёт `"1234"`,
 * `1234::int` — `1234`. Драйвер поступает так намеренно: int8 вмещает больше
 * Number.MAX_SAFE_INTEGER, и молчаливая потеря точности хуже строки.
 *
 * Типизированный путь Drizzle (`db.select().from(...)`) применяет собственный
 * маппер и отдаёт число; расходится только сырой `db.execute` — то есть ровно
 * тот путь, которым в этом проекте написаны аналитические запросы.
 *
 * Number() здесь безопасен: самый просматриваемый рилс в выгрузке —
 * 14 123 499, до 2^53 запас в шесть порядков.
 */
function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null

  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * Тот же класс проблемы, что и с BIGINT выше: `db.execute()` отдаёт
 * timestamptz строкой в текстовом формате Postgres («2026-08-17 18:33:12+00»),
 * а не объектом Date, — типизированный маппер Drizzle сюда не дотягивается.
 * `ReelListRow` обещает `Date`, и на этом обещании держится форматирование
 * (`formatRelative` проверяет `instanceof Date`) и сортировка ленты по
 * умолчанию (`row.createdAt.getTime()` без защитной проверки). Без приведения
 * карточка молча показывает «—» вместо даты, а лента из двух и более рилсов
 * падает с TypeError при первом же рендере — воспроизведено вручную в браузере.
 */
function toDate(value: unknown): Date | null {
  if (value === null || value === undefined) return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value

  const parsed = new Date(value as string)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

/**
 * Имена в ORDER BY — АЛИАСЫ внутреннего запроса, а не колонки таблиц.
 * Кавычки делают идентификатор регистрозависимым: после `AS "createdAt"`
 * колонки `created_at` во внешней области видимости уже не существует.
 */
const ORDER: Record<ReelSort, ReturnType<typeof sql>> = {
  // NULLS LAST: рилс в статусе pending ещё без даты — ему не место наверху.
  date: sql`"postedAt" DESC NULLS LAST`,
  views: sql`views DESC NULLS LAST`,
  growth: sql`"growth7d" DESC NULLS LAST`,
  added: sql`"createdAt" DESC`,
}

/**
 * Лента рилсов: последние метрики по каждому плюс прирост за неделю.
 *
 * Запрос один, а не два, намеренно. На free tier Neon засыпает после простоя,
 * и каждый лишний раунд-трип добавляет секунду к первому открытию кабинета.
 *
 * `DISTINCT ON` — специфичный для Postgres приём: он берёт первую строку в
 * каждой группе по указанному выражению. Планировщик закрывает его одним
 * индексным сканом по `(reel_id, captured_at DESC)` — тем самым
 * `idx_snapshots_reel_ts`, что объявлен в схеме. Эквивалент через
 * `ROW_NUMBER() OVER (...) WHERE rn = 1` даёт тот же результат, но
 * материализует все снапшоты, прежде чем отбросить лишние.
 *
 * Сортировка навешивается СНАРУЖИ подзапросом: `DISTINCT ON` требует, чтобы
 * `ORDER BY` начинался с выражения из самого `DISTINCT ON`.
 */
export async function listReels(userId: string, sort: ReelSort = 'added') {
  const rows = await db.execute(sql`
    WITH ranked AS (
      -- Оконные функции считаются по ОДНОМУ проходу: нумерация от свежих,
      -- нумерация от старых и размер группы — всё за один скан окна.
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
      SELECT reel_id,
             -- Без CASE рилс с единственной точкой дал бы rn_new = rn_old = 1,
             -- то есть прирост 0, и лента написала бы «+0» там, где честный
             -- ответ — «данных пока мало». PLAN.md §8.
             CASE WHEN MAX(points) > 1
                  THEN MAX(views) FILTER (WHERE rn_new = 1)
                     - MAX(views) FILTER (WHERE rn_old = 1)
             END AS growth_7d
      FROM ranked
      GROUP BY reel_id
    )
    SELECT * FROM (
      SELECT DISTINCT ON (r.id)
             r.id,
             r.shortcode,
             r.url,
             r.caption,
             r.owner_username   AS "ownerUsername",
             r.thumbnail_src    AS "thumbnailSrc",
             r.posted_at        AS "postedAt",
             r.sync_status      AS "syncStatus",
             r.sync_error       AS "syncError",
             r.last_synced_at   AS "lastSyncedAt",
             r.created_at       AS "createdAt",
             s.views,
             s.likes,
             s.comments,
             s.captured_at      AS "capturedAt",
             g.growth_7d        AS "growth7d"
      FROM reels r
      LEFT JOIN reel_snapshots s ON s.reel_id = r.id
      LEFT JOIN growth g         ON g.reel_id = r.id
      WHERE r.user_id = ${userId}
      ORDER BY r.id, s.captured_at DESC
    ) AS latest
    ORDER BY ${ORDER[sort]}
  `)

  const raw = (Array.isArray(rows) ? rows : ((rows as { rows?: unknown[] }).rows ?? [])) as Record<
    string,
    unknown
  >[]

  return raw.map((row) => ({
    ...row,
    views: toNumber(row.views),
    likes: toNumber(row.likes),
    comments: toNumber(row.comments),
    growth7d: toNumber(row.growth7d),
    postedAt: toDate(row.postedAt),
    lastSyncedAt: toDate(row.lastSyncedAt),
    capturedAt: toDate(row.capturedAt),
    // created_at — NOT NULL в схеме и приходит от ведущей таблицы (reels),
    // а не через LEFT JOIN: здесь это всегда настоящая дата.
    createdAt: toDate(row.createdAt) as Date,
  })) as ReelListRow[]
}
