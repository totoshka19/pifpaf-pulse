import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db, reels, reelSnapshots, syncRuns, users } from '@/db'
import { reelDetail } from './reel-detail'

/**
 * Экран одного рилса — на ЖИВОЙ базе Neon.
 *
 * Главное здесь — изоляция. Чужой рилс и несуществующий рилс обязаны быть
 * НЕОТЛИЧИМЫ снаружи: оба дают `null`. Если чужой отвечал бы иначе, перебором
 * идентификаторов можно было бы выяснить, какие рилсы вообще заведены
 * в системе.
 */

const OWNER = 'detail-owner@example.invalid'
const STRANGER = 'detail-stranger@example.invalid'

const EMAILS = [OWNER, STRANGER]

const HOUR = 3_600_000
const ago = (hours: number) => new Date(Date.now() - hours * HOUR)

const ids: Record<string, string> = {}

async function seedUser(email: string): Promise<string> {
  const [user] = await db
    .insert(users)
    .values({ email, passwordHash: 'x', displayName: 'Тест' })
    .returning({ id: users.id })
  return user.id
}

beforeAll(async () => {
  for (const email of EMAILS) await db.delete(users).where(eq(users.email, email))

  ids.owner = await seedUser(OWNER)
  ids.stranger = await seedUser(STRANGER)

  const [mine] = await db
    .insert(reels)
    .values({
      userId: ids.owner,
      shortcode: 'DetailMine',
      url: 'https://www.instagram.com/reel/DetailMine/',
      caption: 'Мой рилс',
      ownerUsername: 'anya',
      syncStatus: 'ok',
      postedAt: ago(72),
      lastSyncedAt: ago(1),
    })
    .returning({ id: reels.id })
  ids.mine = mine.id

  // Снапшоты вставляем ВРАЗБРОС: запрос обязан отсортировать сам.
  for (const snap of [
    { views: 3000, at: ago(1) },
    { views: 1000, at: ago(48) },
    { views: 2000, at: ago(24) },
  ]) {
    await db.insert(reelSnapshots).values({
      reelId: mine.id,
      views: snap.views,
      likes: snap.views / 10,
      comments: snap.views / 100,
      capturedAt: snap.at,
    })
  }

  // Прогоны тоже вразброс.
  for (const run of [
    { status: 'succeeded' as const, at: ago(24), apify: 'mock:aaa', error: null },
    { status: 'failed' as const, at: ago(48), apify: null, error: 'Instagram не ответил' },
    { status: 'succeeded' as const, at: ago(1), apify: 'mock:bbb', error: null },
  ]) {
    await db.insert(syncRuns).values({
      reelId: mine.id,
      status: run.status,
      apifyRunId: run.apify,
      error: run.error,
      startedAt: run.at,
      finishedAt: new Date(run.at.getTime() + 15_000),
    })
  }

  // Рилс без единого снапшота — так выглядит только что добавленная ссылка.
  const [bare] = await db
    .insert(reels)
    .values({
      userId: ids.owner,
      shortcode: 'DetailBare',
      url: 'https://www.instagram.com/reel/DetailBare/',
      syncStatus: 'pending',
    })
    .returning({ id: reels.id })
  ids.bare = bare.id

  const [alien] = await db
    .insert(reels)
    .values({
      userId: ids.stranger,
      shortcode: 'DetailAlien',
      url: 'https://www.instagram.com/reel/DetailAlien/',
      syncStatus: 'ok',
    })
    .returning({ id: reels.id })
  ids.alien = alien.id
})

afterAll(async () => {
  for (const email of EMAILS) await db.delete(users).where(eq(users.email, email))
})

describe('reelDetail — изоляция', () => {
  it('чужой рилс неотличим от несуществующего: оба null', async () => {
    const alien = await reelDetail(ids.owner, ids.alien)
    const ghost = await reelDetail(ids.owner, '00000000-0000-4000-8000-000000000000')

    expect(alien).toBeNull()
    expect(ghost).toBeNull()
  })

  it('свой рилс отдаётся', async () => {
    const detail = await reelDetail(ids.owner, ids.mine)

    expect(detail?.reel.shortcode).toBe('DetailMine')
  })

  it('битый идентификатор не роняет запрос', async () => {
    // Из адресной строки может прийти что угодно; uuid-колонка на мусоре
    // бросает ошибку типа, и она не должна вылетать пятисоткой.
    expect(await reelDetail(ids.owner, 'не-uuid-вовсе')).toBeNull()
  })
})

describe('reelDetail — снапшоты', () => {
  it('отдаёт снапшоты по возрастанию времени', async () => {
    const detail = await reelDetail(ids.owner, ids.mine)
    const views = detail!.snapshots.map((s) => s.views)

    // График роста рисуется слева направо: порядок задаёт запрос, а не клиент.
    expect(views).toEqual([1000, 2000, 3000])
  })

  it('метрики — числа, а даты — настоящие Date', async () => {
    const detail = await reelDetail(ids.owner, ids.mine)
    const first = detail!.snapshots[0]

    expect(typeof first.views).toBe('number')
    expect(typeof first.likes).toBe('number')
    expect(first.capturedAt).toBeInstanceOf(Date)
  })

  it('рилс без снапшотов даёт пустой массив, а не ошибку', async () => {
    const detail = await reelDetail(ids.owner, ids.bare)

    expect(detail).not.toBeNull()
    expect(detail!.snapshots).toEqual([])
  })
})

describe('reelDetail — лог синхронизаций', () => {
  it('отдаёт прогоны по убыванию времени: свежий сверху', async () => {
    const detail = await reelDetail(ids.owner, ids.mine)
    const runs = detail!.runs

    expect(runs).toHaveLength(3)
    for (let i = 1; i < runs.length; i++) {
      expect(runs[i - 1].startedAt.getTime()).toBeGreaterThanOrEqual(runs[i].startedAt.getTime())
    }
  })

  it('сохраняет статус и текст ошибки', async () => {
    const detail = await reelDetail(ids.owner, ids.mine)
    const failed = detail!.runs.find((r) => r.status === 'failed')

    expect(failed?.error).toBe('Instagram не ответил')
  })

  it('даты прогонов — настоящие Date', async () => {
    const detail = await reelDetail(ids.owner, ids.mine)

    expect(detail!.runs[0].startedAt).toBeInstanceOf(Date)
    expect(detail!.runs[0].finishedAt).toBeInstanceOf(Date)
  })

  it('видно, что прогон был на фикстурах, а не на живом Apify', async () => {
    // Режим прода читается из базы: мок пишет в apify_run_id префикс `mock:`.
    const detail = await reelDetail(ids.owner, ids.mine)

    expect(detail!.runs.some((r) => r.isMock)).toBe(true)
  })

  it('рилс без прогонов даёт пустой массив', async () => {
    const detail = await reelDetail(ids.owner, ids.bare)

    expect(detail!.runs).toEqual([])
  })

  it('различает ручной прогон и прогон по расписанию', async () => {
    await db.insert(syncRuns).values({
      reelId: ids.mine,
      userId: ids.owner,
      shortcode: 'DetailMine',
      triggeredBy: 'cron',
      status: 'succeeded',
      apifyRunId: 'mock:ccc',
      startedAt: ago(2),
      finishedAt: ago(2),
    })

    const detail = await reelDetail(ids.owner, ids.mine)

    // Три прогона, засеянных в beforeAll, идут без явного triggeredBy и
    // получают дефолт 'manual'. Проверяются ОБЕ стороны: запрос, отдающий
    // константу, а не колонку, покраснеет на одной из них.
    expect(detail!.runs.some((r) => r.triggeredBy === 'cron')).toBe(true)
    expect(detail!.runs.some((r) => r.triggeredBy === 'manual')).toBe(true)
  })
})
