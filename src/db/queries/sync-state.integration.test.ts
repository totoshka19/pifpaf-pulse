import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db, reels, syncRuns, users } from '@/db'
import { lastAttemptFor } from './sync-state'

const OWNER = 'sync-state-owner@example.invalid'
const STRANGER = 'sync-state-stranger@example.invalid'

let userId: string
let reelId: string

beforeAll(async () => {
  await db.delete(users).where(eq(users.email, OWNER))

  const [user] = await db
    .insert(users)
    .values({ email: OWNER, passwordHash: 'x', displayName: 'Тест' })
    .returning({ id: users.id })
  userId = user.id

  const [reel] = await db
    .insert(reels)
    .values({
      userId,
      shortcode: 'SyncStateA',
      url: 'https://www.instagram.com/reel/SyncStateA/',
      syncStatus: 'ok',
    })
    .returning({ id: reels.id })
  reelId = reel.id
})

afterAll(async () => {
  await db.delete(users).where(eq(users.email, OWNER))
  await db.delete(users).where(eq(users.email, STRANGER))
})

describe('sync_runs — новые колонки', () => {
  it('triggered_by по умолчанию manual', async () => {
    const [run] = await db
      .insert(syncRuns)
      .values({ reelId, userId, shortcode: 'SyncStateA', status: 'running' })
      .returning({ triggeredBy: syncRuns.triggeredBy })

    expect(run.triggeredBy).toBe('manual')
  })

  it('прогон переживает удаление рилса', async () => {
    const [reel] = await db
      .insert(reels)
      .values({
        userId,
        shortcode: 'SyncStateGone',
        url: 'https://www.instagram.com/reel/SyncStateGone/',
        syncStatus: 'ok',
      })
      .returning({ id: reels.id })

    const [run] = await db
      .insert(syncRuns)
      .values({
        reelId: reel.id,
        userId,
        shortcode: 'SyncStateGone',
        status: 'succeeded',
      })
      .returning({ id: syncRuns.id })

    await db.delete(reels).where(eq(reels.id, reel.id))

    // Раньше ON DELETE CASCADE стирал строку целиком — и вместе с ней
    // обнулялся любой счётчик, построенный на sync_runs.
    const [survivor] = await db.select().from(syncRuns).where(eq(syncRuns.id, run.id))

    expect(survivor).toBeDefined()
    expect(survivor.reelId).toBeNull()
    expect(survivor.userId).toBe(userId)
    expect(survivor.shortcode).toBe('SyncStateGone')
  })

  it('CHECK не пропускает выдуманный triggered_by', async () => {
    await expect(
      db
        .insert(syncRuns)
        // @ts-expect-error — проверяем защиту на уровне БД, а не типов
        .values({
          reelId,
          userId,
          shortcode: 'SyncStateA',
          status: 'running',
          triggeredBy: 'магия',
        }),
    ).rejects.toThrow()
  })
})

describe('lastAttemptFor — троттлинг переживает удаление рилса', () => {
  it('без попыток отдаёт null', async () => {
    expect(await lastAttemptFor(userId, 'НикогдаНеБыло')).toBeNull()
  })

  it('видит попытку по паре пользователь + шорткод', async () => {
    const at = new Date(Date.now() - 10 * 60_000)
    await db.insert(syncRuns).values({
      reelId,
      userId,
      shortcode: 'SyncStateA',
      status: 'running',
      startedAt: at,
    })

    const found = await lastAttemptFor(userId, 'SyncStateA')

    expect(found).toBeInstanceOf(Date)
    expect(found!.getTime()).toBeGreaterThanOrEqual(at.getTime() - 1000)
  })

  it('ДЫРА ЗАКРЫТА: попытка видна после удаления и повторной вставки рилса', async () => {
    const code = 'SyncStateReadd'

    const [first] = await db
      .insert(reels)
      .values({ userId, shortcode: code, url: `https://x/${code}`, syncStatus: 'ok' })
      .returning({ id: reels.id })

    await db.insert(syncRuns).values({
      reelId: first.id,
      userId,
      shortcode: code,
      status: 'succeeded',
      startedAt: new Date(),
    })

    // Двухкликовая последовательность из ленты: удалить и вставить заново.
    await db.delete(reels).where(eq(reels.id, first.id))
    await db
      .insert(reels)
      .values({ userId, shortcode: code, url: `https://x/${code}`, syncStatus: 'ok' })

    // Рилс новый, id новый — но попытка та же и она обязана быть видна.
    expect(await lastAttemptFor(userId, code)).toBeInstanceOf(Date)
  })

  it('чужие попытки по тому же шорткоду не видны', async () => {
    const [stranger] = await db
      .insert(users)
      .values({
        email: STRANGER,
        passwordHash: 'x',
        displayName: 'Чужой',
      })
      .returning({ id: users.id })

    await db.insert(syncRuns).values({
      userId: stranger.id,
      shortcode: 'ОбщийКод',
      status: 'succeeded',
      startedAt: new Date(),
    })

    expect(await lastAttemptFor(userId, 'ОбщийКод')).toBeNull()

    await db.delete(users).where(eq(users.id, stranger.id))
  })
})
