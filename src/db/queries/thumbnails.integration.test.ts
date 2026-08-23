import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { db, reels, reelThumbnails, users } from '@/db'
import { ensureThumbnail, readThumbnail } from './thumbnails'

/**
 * Хранение обложек — на ЖИВОЙ базе и с ЖИВЫМ скачиванием.
 *
 * Проверяется идемпотентность (повтор не перекачивает) и устойчивость: ссылки
 * Instagram живут ~4,5 суток, значит к моменту дозаливки часть будет мертва,
 * и функция обязана переживать это молча.
 */

const MARKER = 'thumbs-test@example.invalid'
const DIR = join(process.cwd(), 'fixtures', 'apify')

const ITEM = (() => {
  if (!existsSync(DIR)) throw new Error('Нет fixtures/apify — тест бессмыслен')
  const file = readdirSync(DIR).find((f) => f.endsWith('.json'))!
  const parsed = JSON.parse(readFileSync(join(DIR, file), 'utf8'))
  return (Array.isArray(parsed) ? parsed : [parsed])[0]
})()

async function seedReel(thumbnailSrc: string | null) {
  const [user] = await db
    .insert(users)
    .values({ email: MARKER, passwordHash: 'x', displayName: 'Тест' })
    .returning({ id: users.id })

  const [reel] = await db
    .insert(reels)
    .values({
      userId: user.id,
      shortcode: String(ITEM.shortCode),
      url: `https://www.instagram.com/reel/${ITEM.shortCode}/`,
      thumbnailSrc,
      syncStatus: 'ok',
    })
    .returning({ id: reels.id })

  return reel.id
}

const rowCount = async (reelId: string) => {
  const rows = await db.select().from(reelThumbnails).where(eq(reelThumbnails.reelId, reelId))
  return rows.length
}

const cleanup = () => db.execute(sql`DELETE FROM users WHERE email = ${MARKER}`)

beforeEach(cleanup)
afterAll(cleanup)

describe('ensureThumbnail — обычный путь', () => {
  it('скачивает, обрабатывает и сохраняет', async () => {
    const reelId = await seedReel(String(ITEM.displayUrl))

    const result = await ensureThumbnail(reelId)

    // Если здесь 'skipped' — скорее всего протухла ссылка в фикстуре,
    // нужна свежая выгрузка, а не правка кода.
    expect(result).toBe('stored')

    const [row] = await db
      .select()
      .from(reelThumbnails)
      .where(eq(reelThumbnails.reelId, reelId))

    expect(row.mime).toBe('image/webp')
    expect(row.width).toBe(480)
    expect(row.height).toBeGreaterThan(480) // портрет 9:16
    expect(row.bytes).toBe(row.data.length)
    expect(row.bytes).toBeGreaterThan(1000)
    expect(row.bytes).toBeLessThan(200_000)
  }, 30_000)

  it('сохраняет именно WebP, а не переименованный JPEG', async () => {
    const reelId = await seedReel(String(ITEM.displayUrl))
    await ensureThumbnail(reelId)

    const stored = await readThumbnail(reelId)

    expect(stored!.data.subarray(0, 4).toString('ascii')).toBe('RIFF')
    expect(stored!.data.subarray(8, 12).toString('ascii')).toBe('WEBP')
  }, 30_000)
})

describe('ensureThumbnail — идемпотентность', () => {
  it('повтор не перекачивает и не дублирует строку', async () => {
    const reelId = await seedReel(String(ITEM.displayUrl))

    expect(await ensureThumbnail(reelId)).toBe('stored')

    const started = Date.now()
    expect(await ensureThumbnail(reelId)).toBe('exists')
    const elapsed = Date.now() - started

    expect(await rowCount(reelId)).toBe(1)
    // Скачивание занимает 0,5–1,8 с. Быстрый ответ доказывает, что сети не было.
    expect(elapsed).toBeLessThan(400)
  }, 30_000)
})

describe('ensureThumbnail — устойчивость', () => {
  it('без thumbnailSrc пропускает', async () => {
    const reelId = await seedReel(null)

    expect(await ensureThumbnail(reelId)).toBe('skipped')
    expect(await rowCount(reelId)).toBe(0)
  })

  it('мёртвая ссылка пропускается БЕЗ исключения', async () => {
    // Ключевой случай: ссылки Instagram протухают за ~4,5 суток.
    const reelId = await seedReel(
      'https://scontent.cdninstagram.com/v/t51.0-0/протухло.jpg?oe=00000000',
    )

    expect(await ensureThumbnail(reelId)).toBe('skipped')
    expect(await rowCount(reelId)).toBe(0)
  }, 30_000)

  it('ссылка на не-картинку пропускается', async () => {
    const reelId = await seedReel('https://example.com/')

    expect(await ensureThumbnail(reelId)).toBe('skipped')
    expect(await rowCount(reelId)).toBe(0)
  }, 30_000)

  it('несуществующий рилс не роняет', async () => {
    expect(await ensureThumbnail('00000000-0000-0000-0000-000000000000')).toBe('skipped')
  })
})

describe('readThumbnail', () => {
  it('отдаёт то, что положили, байт в байт', async () => {
    const reelId = await seedReel(String(ITEM.displayUrl))
    await ensureThumbnail(reelId)

    const [row] = await db
      .select()
      .from(reelThumbnails)
      .where(eq(reelThumbnails.reelId, reelId))
    const read = await readThumbnail(reelId)

    expect(read!.data.equals(row.data)).toBe(true)
    expect(read!.mime).toBe(row.mime)
  }, 30_000)

  it('на рилс без обложки отдаёт null', async () => {
    const reelId = await seedReel(null)
    expect(await readThumbnail(reelId)).toBeNull()
  })
})

describe('каскадное удаление', () => {
  it('удаление рилса уносит обложку', async () => {
    const reelId = await seedReel(String(ITEM.displayUrl))
    await ensureThumbnail(reelId)
    expect(await rowCount(reelId)).toBe(1)

    await db.delete(reels).where(eq(reels.id, reelId))

    expect(await rowCount(reelId)).toBe(0)
  }, 30_000)
})
