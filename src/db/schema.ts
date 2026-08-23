import { sql } from 'drizzle-orm'
import {
  bigint,
  bigserial,
  check,
  customType,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

/**
 * Схема PifPaf Pulse. Подробности решений — в PLAN.md §8.
 *
 * Ключевая идея: `reels` — сущность, `reelSnapshots` — временной ряд.
 * Метрики не перезаписываются, а дописываются строками. Без этого нет
 * ни графиков роста, ни выполненного требования ТЗ «обновляется».
 */

/** У Drizzle нет встроенного bytea — объявляем свой тип. */
const bytea = customType<{ data: Buffer; default: false }>({
  dataType: () => 'bytea',
})

/**
 * Важно про `text(..., { enum: [...] })`: это подсказка ТОЛЬКО для TypeScript,
 * в SQL из неё не попадает ничего. Поэтому рядом с каждой такой колонкой стоит
 * CHECK — база обязана отвергать невозможные значения независимо от того,
 * какой код в неё пишет: сид, ручной SQL или будущий эндпоинт.
 */
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    email: text('email').notNull().unique(),
    passwordHash: text('password_hash').notNull(),
    displayName: text('display_name').notNull(),
    instagramHandle: text('instagram_handle'),
    avatarUrl: text('avatar_url'),
    role: text('role', { enum: ['blogger', 'admin'] })
      .notNull()
      .default('blogger'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check('ck_users_role', sql`${t.role} IN ('blogger', 'admin')`)],
)

export const reels = pgTable(
  'reels',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    shortcode: text('shortcode').notNull(),
    url: text('url').notNull(),
    caption: text('caption'),
    ownerUsername: text('owner_username'),
    /** Оригинальный CDN-URL. Только для отладки: он протухает за сутки. */
    thumbnailSrc: text('thumbnail_src'),
    postedAt: timestamp('posted_at', { withTimezone: true }),
    durationSec: numeric('duration_sec', { precision: 6, scale: 2 }),
    syncStatus: text('sync_status', {
      enum: ['pending', 'ok', 'failed', 'unavailable'],
    })
      .notNull()
      .default('pending'),
    syncError: text('sync_error'),
    /** Обновляется при КАЖДОМ успешном опросе — доказательство свежести данных. */
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    /** Когда опрашивать в следующий раз. Считается по возрасту рилса, PLAN.md §7. */
    nextSyncAt: timestamp('next_sync_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_reels_user_shortcode').on(t.userId, t.shortcode),
    index('idx_reels_user').on(t.userId),
    // Частичный индекс: приватные и удалённые рилсы незачем опрашивать вечно.
    index('idx_reels_due')
      .on(t.nextSyncAt)
      .where(sql`sync_status <> 'unavailable'`),
    check(
      'ck_reels_sync_status',
      sql`${t.syncStatus} IN ('pending', 'ok', 'failed', 'unavailable')`,
    ),
  ],
)

/**
 * Временной ряд метрик.
 *
 * Строка пишется ТОЛЬКО если значения отличаются от предыдущего снапшота.
 * Иначе при частом опросе график роста превращается в лестницу из одинаковых
 * точек, а таблица растёт на сотни строк в сутки без новой информации.
 */
export const reelSnapshots = pgTable(
  'reel_snapshots',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    reelId: uuid('reel_id')
      .notNull()
      .references(() => reels.id, { onDelete: 'cascade' }),
    views: bigint('views', { mode: 'number' }),
    plays: bigint('plays', { mode: 'number' }),
    likes: bigint('likes', { mode: 'number' }),
    comments: bigint('comments', { mode: 'number' }),
    capturedAt: timestamp('captured_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_snapshots_reel_ts').on(t.reelId, t.capturedAt.desc()),
    // Отрицательных просмотров не бывает. Instagram отдаёт -1 как «скрыто»,
    // и normalizeApifyItem превращает его в null — если сюда всё-таки пришёл
    // минус, значит нормализацию обошли, и это надо ловить, а не сохранять.
    check(
      'ck_snapshots_non_negative',
      sql`(${t.views} IS NULL OR ${t.views} >= 0)
      AND (${t.plays} IS NULL OR ${t.plays} >= 0)
      AND (${t.likes} IS NULL OR ${t.likes} >= 0)
      AND (${t.comments} IS NULL OR ${t.comments} >= 0)`,
    ),
  ],
)

/**
 * Обложки отдельной таблицей, а не колонкой в reels.
 *
 * Postgres хранит крупные значения в TOAST, но `SELECT *` их распакует —
 * лента из шестидесяти карточек потащила бы мегабайты на каждый запрос.
 */
export const reelThumbnails = pgTable('reel_thumbnails', {
  reelId: uuid('reel_id')
    .primaryKey()
    .references(() => reels.id, { onDelete: 'cascade' }),
  data: bytea('data').notNull(),
  mime: text('mime').notNull().default('image/webp'),
  width: integer('width'),
  height: integer('height'),
  bytes: integer('bytes').notNull(),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
})

export const syncRuns = pgTable(
  'sync_runs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    reelId: uuid('reel_id').references(() => reels.id, { onDelete: 'cascade' }),
    apifyRunId: text('apify_run_id'),
    status: text('status', { enum: ['running', 'succeeded', 'failed'] }).notNull(),
    error: text('error'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [
    check('ck_sync_runs_status', sql`${t.status} IN ('running', 'succeeded', 'failed')`),
  ],
)

/** Предохранитель бюджета Apify. PLAN.md §7: потолок free tier ≈1850/мес. */
export const apifyUsage = pgTable(
  'apify_usage',
  {
    period: text('period').primaryKey(), // 'YYYY-MM'
    results: integer('results').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Ключ — период вида 2026-08. Опечатка в формате раскидала бы счётчик
    // по нескольким строкам, и предохранитель бюджета молча перестал бы работать.
    check('ck_apify_usage_period', sql`${t.period} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
    check('ck_apify_usage_results', sql`${t.results} >= 0`),
  ],
)
