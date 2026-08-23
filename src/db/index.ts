import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

/**
 * Клиент БД для приложения.
 *
 * DATABASE_URL указывает на пулер Neon (хост с «-pooler») — это PgBouncer
 * в режиме transaction pooling. Отсюда `prepare: false`: prepared statements
 * живут в рамках сессии, а пулер подсовывает разные физические сессии между
 * запросами, и подготовленный запрос «теряется».
 *
 * Миграции ходят мимо этого файла, по DATABASE_URL_UNPOOLED — см. drizzle.config.ts.
 */

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL не задан')

const client = postgres(url, { prepare: false })

export const db = drizzle(client, { schema })
export * from './schema'
