import { sql } from 'drizzle-orm'
import { db } from '@/db'

export type ReelSort = 'added' | 'date' | 'views'

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
}

/**
 * Лента рилсов с последними метриками по каждому.
 *
 * `DISTINCT ON` — специфичный для Postgres приём: он берёт первую строку в каждой
 * группе по указанному выражению. Планировщик закрывает его одним индексным
 * сканом по `(reel_id, captured_at DESC)` — тем самым `idx_snapshots_reel_ts`,
 * что объявлен в схеме. Эквивалент через `ROW_NUMBER() OVER (...) WHERE rn = 1`
 * даёт тот же результат, но материализует все снапшоты, прежде чем отбросить
 * лишние.
 *
 * Сортировка навешивается СНАРУЖИ подзапросом: `DISTINCT ON` требует, чтобы
 * `ORDER BY` начинался с выражения из самого `DISTINCT ON`, поэтому упорядочить
 * по просмотрам в том же запросе нельзя.
 */
/**
 * Имена здесь — АЛИАСЫ внутреннего запроса, а не колонки таблиц.
 * Кавычки делают идентификатор регистрозависимым: после `AS "createdAt"`
 * колонки `created_at` во внешней области видимости уже не существует.
 */
const ORDER: Record<ReelSort, ReturnType<typeof sql>> = {
  // NULLS LAST: рилс в статусе pending ещё без даты — ему не место наверху.
  date: sql`"postedAt" DESC NULLS LAST`,
  views: sql`views DESC NULLS LAST`,
  added: sql`"createdAt" DESC`,
}

export async function listReels(userId: string, sort: ReelSort = 'added') {
  const rows = await db.execute(sql`
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
             s.captured_at      AS "capturedAt"
      FROM reels r
      LEFT JOIN reel_snapshots s ON s.reel_id = r.id
      WHERE r.user_id = ${userId}
      ORDER BY r.id, s.captured_at DESC
    ) AS latest
    ORDER BY ${ORDER[sort]}
  `)

  return (Array.isArray(rows) ? rows : ((rows as { rows?: unknown[] }).rows ?? [])) as ReelListRow[]
}
