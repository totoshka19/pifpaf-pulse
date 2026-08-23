import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { db, reels, reelSnapshots, users } from '@/db'
import { ingestReel } from './ingest'

/**
 * Запись результата Apify в базу — на ЖИВОЙ базе.
 *
 * Главное правило среза живёт в SQL, а не в TypeScript: снапшот пишется ТОЛЬКО
 * если метрики изменились, а `last_synced_at` обновляется ВСЕГДА. На моках это
 * не проверить — нужно видеть, сколько строк реально легло в таблицу.
 */

const MARKER = 'ingest-test@example.invalid'

/** Берём настоящий элемент из фикстур: подделка не поймает расхождение схемы. */
function fixtureItem(): Record<string, unknown> {
  const dir = join(process.cwd(), 'fixtures', 'apify')
  if (!existsSync(dir)) throw new Error('Нет fixtures/apify — тест бессмыслен')

  const file = readdirSync(dir).find((f) => f.endsWith('.json'))!
  const parsed = JSON.parse(readFileSync(join(dir, file), 'utf8'))
  return Array.isArray(parsed) ? parsed[0] : parsed
}

const ITEM = fixtureItem()
const SHORTCODE = String(ITEM.shortCode)

async function seedReel() {
  const [user] = await db
    .insert(users)
    .values({ email: MARKER, passwordHash: 'x', displayName: 'Тест' })
    .returning({ id: users.id })

  const [reel] = await db
    .insert(reels)
    .values({
      userId: user.id,
      shortcode: SHORTCODE,
      url: `https://www.instagram.com/reel/${SHORTCODE}/`,
      syncStatus: 'pending',
    })
    .returning({ id: reels.id })

  return reel.id
}

const snapshotCount = async (reelId: string) => {
  const rows = await db.select().from(reelSnapshots).where(eq(reelSnapshots.reelId, reelId))
  return rows.length
}

const readReel = async (reelId: string) => {
  const [row] = await db.select().from(reels).where(eq(reels.id, reelId))
  return row
}

const cleanup = () => db.execute(sql`DELETE FROM users WHERE email = ${MARKER}`)

beforeEach(cleanup)
afterAll(cleanup)

describe('ingestReel — первая запись', () => {
  it('заполняет поля рилса и пишет снапшот', async () => {
    const reelId = await seedReel()

    const result = await ingestReel(reelId, [ITEM])

    expect(result).toEqual({ status: 'ok', snapshotWritten: true })

    const reel = await readReel(reelId)
    expect(reel.syncStatus).toBe('ok')
    expect(reel.syncError).toBeNull()
    expect(reel.ownerUsername).toBe(ITEM.ownerUsername)
    expect(reel.postedAt).toBeInstanceOf(Date)
    expect(reel.thumbnailSrc).toBeTruthy()
    expect(reel.lastSyncedAt).toBeInstanceOf(Date)
    expect(reel.nextSyncAt).toBeInstanceOf(Date)

    expect(await snapshotCount(reelId)).toBe(1)
  })

  it('переносит метрики в снапшот', async () => {
    const reelId = await seedReel()
    await ingestReel(reelId, [ITEM])

    const [snap] = await db
      .select()
      .from(reelSnapshots)
      .where(eq(reelSnapshots.reelId, reelId))

    expect(snap.views).toBe(ITEM.videoPlayCount)
    expect(snap.likes).toBe(ITEM.likesCount)
    expect(snap.comments).toBe(ITEM.commentsCount)
  })

  it('назначает следующий опрос в будущем', async () => {
    const reelId = await seedReel()
    const now = new Date()
    await ingestReel(reelId, [ITEM], now)

    const reel = await readReel(reelId)
    expect(reel.nextSyncAt!.getTime()).toBeGreaterThan(now.getTime())
  })
})

describe('ingestReel — повтор без изменений', () => {
  it('НЕ пишет второй снапшот, но обновляет last_synced_at', async () => {
    // Ключевой тест среза. Без этого правила при опросе раз в час график роста
    // превращается в лестницу из одинаковых точек, а таблица пухнет впустую.
    const reelId = await seedReel()

    const first = new Date('2026-08-23T10:00:00Z')
    const second = new Date('2026-08-23T11:00:00Z')

    await ingestReel(reelId, [ITEM], first)
    const result = await ingestReel(reelId, [ITEM], second)

    expect(result).toEqual({ status: 'ok', snapshotWritten: false })
    expect(await snapshotCount(reelId)).toBe(1)

    const reel = await readReel(reelId)
    expect(reel.lastSyncedAt!.toISOString()).toBe(second.toISOString())
  })

  it('десять одинаковых опросов оставляют один снапшот', async () => {
    const reelId = await seedReel()

    for (let i = 0; i < 10; i++) {
      await ingestReel(reelId, [ITEM], new Date(Date.parse('2026-08-23T10:00:00Z') + i * 3_600_000))
    }

    expect(await snapshotCount(reelId)).toBe(1)
  })
})

describe('ingestReel — метрики изменились', () => {
  it('пишет второй снапшот', async () => {
    const reelId = await seedReel()

    await ingestReel(reelId, [ITEM])
    const grown = { ...ITEM, videoPlayCount: Number(ITEM.videoPlayCount) + 1000 }
    const result = await ingestReel(reelId, [grown])

    expect(result.snapshotWritten).toBe(true)
    expect(await snapshotCount(reelId)).toBe(2)
  })

  it('изменения одних только лайков достаточно', async () => {
    const reelId = await seedReel()

    await ingestReel(reelId, [ITEM])
    await ingestReel(reelId, [{ ...ITEM, likesCount: Number(ITEM.likesCount) + 1 }])

    expect(await snapshotCount(reelId)).toBe(2)
  })
})

describe('ingestReel — рилс недоступен', () => {
  it('пустой датасет помечает рилс unavailable', async () => {
    // Штатный ответ Apify на приватную или удалённую запись, а не ошибка.
    const reelId = await seedReel()

    const result = await ingestReel(reelId, [])

    expect(result).toEqual({ status: 'unavailable', snapshotWritten: false })

    const reel = await readReel(reelId)
    expect(reel.syncStatus).toBe('unavailable')
    expect(reel.syncError).toBeTruthy()
    expect(reel.syncError).not.toMatch(/error|null|undefined/i)
    expect(reel.lastSyncedAt).toBeInstanceOf(Date)
  })

  it('снимает недоступный рилс с расписания — иначе опрашивали бы вечно', () => {
    return (async () => {
      const reelId = await seedReel()
      await ingestReel(reelId, [])

      const reel = await readReel(reelId)
      expect(reel.nextSyncAt).toBeNull()
    })()
  })

  it('датасет с ЧУЖИМ рилсом тоже считается недоступностью', async () => {
    // Батч возвращает элементы вперемешку: сопоставление строго по shortcode,
    // иначе рилсу достались бы чужие метрики.
    const reelId = await seedReel()

    const result = await ingestReel(reelId, [{ ...ITEM, shortCode: 'ДругойКод' }])

    expect(result.status).toBe('unavailable')
    expect(await snapshotCount(reelId)).toBe(0)
  })

  it('выбирает свой элемент из батча с несколькими', async () => {
    const reelId = await seedReel()

    const result = await ingestReel(reelId, [
      { ...ITEM, shortCode: 'Чужой1', videoPlayCount: 1 },
      ITEM,
      { ...ITEM, shortCode: 'Чужой2', videoPlayCount: 2 },
    ])

    expect(result.status).toBe('ok')

    const [snap] = await db
      .select()
      .from(reelSnapshots)
      .where(eq(reelSnapshots.reelId, reelId))

    expect(snap.views).toBe(ITEM.videoPlayCount)
  })
})

describe('ingestReel — несуществующий рилс', () => {
  it('бросает ошибку, а не пишет в никуда', async () => {
    await expect(
      ingestReel('00000000-0000-0000-0000-000000000000', [ITEM]),
    ).rejects.toThrow()
  })
})
