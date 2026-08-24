import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db, reels, syncRuns, users } from '@/db'
import { lastAttemptFor, manualAttemptsSince } from './sync-state'

const OWNER = 'sync-state-owner@example.invalid'
const STRANGER = 'sync-state-stranger@example.invalid'
const COUNTER = 'sync-state-counter@example.invalid'
const CRON_USER = 'sync-state-cron@example.invalid'

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
  await db.delete(users).where(eq(users.email, COUNTER))
  await db.delete(users).where(eq(users.email, CRON_USER))
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

  it('видит именно ПОСЛЕДНЮЮ попытку по паре, а не любую из её истории', async () => {
    // Раньше здесь стояла версия, вставлявшая одну строку и проверявшая
    // только нижнюю границу (found >= at - 1000). Она была зелёной, но
    // ничего не доказывала: 'SyncStateA' уже несёт более свежую строку из
    // соседнего describe («triggered_by по умолчанию manual»), и слабый
    // ассерт не отличал «нашли правильную строку» от «нашли вообще любую
    // строку не старше порога». ORDER BY started_at DESC оставался
    // непокрытым — перевёрнутый на ASC, тест остался бы зелёным. Здесь
    // сортировка проверяется напрямую через точное равенство, на отдельном
    // шорткоде, чтобы не зависеть от строк из соседних тестов.
    const code = 'SyncStateOrder'
    const earlier = new Date(Date.now() - 45 * 60_000)
    const later = new Date(Date.now() - 5 * 60_000)

    // Вставка НАРОЧНО в обратном порядке относительно времени: свежая по
    // времени строка вставляется первой, старая — второй. Так тест не
    // спутать с проверкой «вернулась последняя ВСТАВЛЕННАЯ строка» —
    // это разные вещи, и ORDER BY started_at DESC обязан вернуть именно
    // позднюю по ВРЕМЕНИ, а не по порядку вставки.
    await db.insert(syncRuns).values({
      userId,
      shortcode: code,
      status: 'succeeded',
      startedAt: later,
    })
    await db.insert(syncRuns).values({
      userId,
      shortcode: code,
      status: 'succeeded',
      startedAt: earlier,
    })

    const found = await lastAttemptFor(userId, code)

    expect(found).toBeInstanceOf(Date)
    expect(found!.getTime()).toBe(later.getTime())
    expect(found!.getTime()).not.toBe(earlier.getTime())
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

describe('manualAttemptsSince', () => {
  it('считает только свежие попытки', async () => {
    const [fresh] = await db
      .insert(users)
      .values({
        email: COUNTER,
        passwordHash: 'x',
        displayName: 'Счёт',
      })
      .returning({ id: users.id })

    const now = Date.now()
    for (const minutesAgo of [0, 0.5, 5]) {
      await db.insert(syncRuns).values({
        userId: fresh.id,
        shortcode: `C${minutesAgo}`,
        status: 'running',
        triggeredBy: 'manual',
        startedAt: new Date(now - minutesAgo * 60_000),
      })
    }

    // Окно в минуту захватывает две из трёх.
    expect(await manualAttemptsSince(fresh.id, new Date(now - 60_000))).toBe(2)

    await db.delete(users).where(eq(users.id, fresh.id))
  })

  it('НЕ считает прогоны крона', async () => {
    const [cronUser] = await db
      .insert(users)
      .values({
        email: CRON_USER,
        passwordHash: 'x',
        displayName: 'Крон',
      })
      .returning({ id: users.id })

    // Тик крона тронул десять рилсов этого блогера. Он ничего не нажимал,
    // и его кнопка «Обновить» блокироваться не должна.
    for (let i = 0; i < 10; i++) {
      await db.insert(syncRuns).values({
        userId: cronUser.id,
        shortcode: `Cron${i}`,
        status: 'running',
        triggeredBy: 'cron',
        startedAt: new Date(),
      })
    }

    expect(await manualAttemptsSince(cronUser.id, new Date(Date.now() - 60_000))).toBe(0)

    await db.delete(users).where(eq(users.id, cronUser.id))
  })

  it('переживает удаление рилса', async () => {
    const [reel] = await db
      .insert(reels)
      .values({
        userId,
        shortcode: 'CounterSurvives',
        url: 'https://x/CounterSurvives',
        syncStatus: 'ok',
      })
      .returning({ id: reels.id })

    await db.insert(syncRuns).values({
      reelId: reel.id,
      userId,
      shortcode: 'CounterSurvives',
      status: 'running',
      triggeredBy: 'manual',
      startedAt: new Date(),
    })

    const before = await manualAttemptsSince(userId, new Date(Date.now() - 60_000))
    await db.delete(reels).where(eq(reels.id, reel.id))
    const after = await manualAttemptsSince(userId, new Date(Date.now() - 60_000))

    // Раньше CASCADE обнулял счётчик вместе с рилсом — то есть лимит
    // сбрасывался тем же действием, от которого должен защищать.
    expect(after).toBe(before)
  })
})
