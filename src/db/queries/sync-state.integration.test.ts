import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db, reels, syncRuns, users } from '@/db'

const OWNER = 'sync-state-owner@example.invalid'

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
