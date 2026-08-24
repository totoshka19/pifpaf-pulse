import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db, reels, reelSnapshots, users } from '@/db'
import { listReels, type ReelSort } from './list-reels'

/**
 * Лента на ЖИВОЙ базе Neon.
 *
 * Здесь проверяются две вещи, которые юнит-тест не увидит в принципе:
 * реальные типы, которыми драйвер отдаёт BIGINT, и поведение оконной функции
 * на границе окна в семь дней.
 */

const MARKER = 'feed-test@example.invalid'
const STRANGER = 'feed-stranger@example.invalid'

const DAY = 86_400_000
const ago = (days: number) => new Date(Date.now() - days * DAY)

let ownerId: string
let strangerId: string
const ids: Record<string, string> = {}

async function seedUser(email: string): Promise<string> {
  const [user] = await db
    .insert(users)
    .values({ email, passwordHash: 'x', displayName: 'Тест' })
    .returning({ id: users.id })
  return user.id
}

async function seedReel(
  userId: string,
  shortcode: string,
  snapshots: { views: number; at: Date }[],
): Promise<string> {
  const [reel] = await db
    .insert(reels)
    .values({
      userId,
      shortcode,
      url: `https://www.instagram.com/reel/${shortcode}/`,
      syncStatus: 'ok',
      postedAt: ago(10),
    })
    .returning({ id: reels.id })

  for (const snapshot of snapshots) {
    await db.insert(reelSnapshots).values({
      reelId: reel.id,
      views: snapshot.views,
      likes: 100,
      comments: 10,
      capturedAt: snapshot.at,
    })
  }

  return reel.id
}

beforeAll(async () => {
  await db.delete(users).where(eq(users.email, MARKER))
  await db.delete(users).where(eq(users.email, STRANGER))

  ownerId = await seedUser(MARKER)
  strangerId = await seedUser(STRANGER)

  // Две точки внутри окна: прирост считается.
  ids.grew = await seedReel(ownerId, 'FeedGrew', [
    { views: 1000, at: ago(5) },
    { views: 2500, at: ago(1) },
  ])

  // Одна точка внутри окна: честного ответа нет, ждём null.
  ids.single = await seedReel(ownerId, 'FeedOne', [{ views: 7777, at: ago(2) }])

  // Обе точки старше семи дней: в окно не попадают вовсе.
  ids.old = await seedReel(ownerId, 'FeedOld', [
    { views: 500, at: ago(30) },
    { views: 900, at: ago(20) },
  ])

  // Одна точка старая, одна свежая: внутри окна снова одна — значит null.
  ids.edge = await seedReel(ownerId, 'FeedEdge', [
    { views: 100, at: ago(9) },
    { views: 400, at: ago(2) },
  ])

  // Совсем без снапшотов: так выглядит рилс, которому Apify ничего не отдал.
  ids.empty = await seedReel(ownerId, 'FeedNone', [])

  await seedReel(strangerId, 'FeedAlien', [{ views: 999_999, at: ago(1) }])
})

afterAll(async () => {
  await db.delete(users).where(eq(users.email, MARKER))
  await db.delete(users).where(eq(users.email, STRANGER))
})

describe('listReels — типы, которыми приходят числа', () => {
  it('views приходит числом, а не строкой', async () => {
    const rows = await listReels(ownerId)
    const grew = rows.find((row) => row.id === ids.grew)!

    // Замер 2026-08-24: postgres.js отдаёт BIGINT строкой. Без приведения
    // в запросе тут окажется "2500", и весь интерфейс покажет «—».
    expect(typeof grew.views).toBe('number')
    expect(grew.views).toBe(2500)
  })

  it('likes и comments тоже числа', async () => {
    const rows = await listReels(ownerId)
    const grew = rows.find((row) => row.id === ids.grew)!

    expect(typeof grew.likes).toBe('number')
    expect(typeof grew.comments).toBe('number')
  })

  it('отсутствующий снапшот даёт null, а не ноль и не строку', async () => {
    const rows = await listReels(ownerId)
    const empty = rows.find((row) => row.id === ids.empty)!

    expect(empty.views).toBeNull()
    expect(empty.growth7d).toBeNull()
  })

  it('даты приходят объектами Date, а не строкой Postgres', async () => {
    // db.execute() отдаёт timestamptz строкой в текстовом формате Postgres
    // («2026-08-17 18:33:12+00»), а не объектом Date — тот же класс проблемы,
    // что и с BIGINT выше, только для дат. Вся лента держится на обещании
    // ReelListRow, что тут Date: formatRelative отличает валидную дату по
    // instanceof Date, а сортировка по умолчанию зовёт row.createdAt.getTime()
    // без защитной проверки. С одним рилсом в ленте баг незаметен —
    // Array.prototype.sort не вызывает компаратор для массива из одного
    // элемента, — и падает только при двух и более: воспроизведено вручную
    // в браузере при проверке задачи 7.
    const rows = await listReels(ownerId)
    const grew = rows.find((row) => row.id === ids.grew)!
    const empty = rows.find((row) => row.id === ids.empty)!

    expect(grew.postedAt).toBeInstanceOf(Date)
    expect(grew.createdAt).toBeInstanceOf(Date)
    expect(grew.capturedAt).toBeInstanceOf(Date)

    // Именно этот вызов бросил TypeError в браузере — проверяем его напрямую,
    // а не через прокси вроде instanceof: getTime() обязан быть конечным
    // числом, а не NaN от Invalid Date.
    expect(Number.isFinite(grew.createdAt.getTime())).toBe(true)

    // У рилса без снапшотов captured_at приходит через LEFT JOIN без пары —
    // там настоящий SQL NULL, а не строка "null" и не Invalid Date.
    expect(empty.capturedAt).toBeNull()
  })
})

describe('listReels — прирост за 7 дней', () => {
  it('считает разность крайних точек внутри окна', async () => {
    const rows = await listReels(ownerId)
    const grew = rows.find((row) => row.id === ids.grew)!

    expect(grew.growth7d).toBe(1500)
    expect(typeof grew.growth7d).toBe('number')
  })

  it('одна точка в окне даёт null, а не «+0»', async () => {
    // Это и есть CASE WHEN MAX(points) > 1 из PLAN.md §8. Без него интерфейс
    // напишет «+0» там, где честный ответ — «данных пока мало».
    const rows = await listReels(ownerId)

    expect(rows.find((row) => row.id === ids.single)!.growth7d).toBeNull()
    expect(rows.find((row) => row.id === ids.edge)!.growth7d).toBeNull()
  })

  it('точки старше семи дней в окно не попадают', async () => {
    const rows = await listReels(ownerId)

    expect(rows.find((row) => row.id === ids.old)!.growth7d).toBeNull()
    // Метрики при этом видны: последний снапшот берётся без окна.
    expect(rows.find((row) => row.id === ids.old)!.views).toBe(900)
  })
})

describe('listReels — сортировка и изоляция', () => {
  it('сортировка по росту ставит выросший рилс первым', async () => {
    const rows = await listReels(ownerId, 'growth')

    expect(rows[0].id).toBe(ids.grew)
    // Остальные с null уходят в конец, а не наверх.
    expect(rows.at(-1)!.growth7d).toBeNull()
  })

  it('сортировка по просмотрам ставит рилс без метрик в конец', async () => {
    const rows = await listReels(ownerId, 'views')

    expect(rows[0].id).toBe(ids.single)
    expect(rows.at(-1)!.id).toBe(ids.empty)
  })

  it('чужие рилсы не видны', async () => {
    const rows = await listReels(ownerId)

    expect(rows).toHaveLength(5)
    expect(rows.some((row) => row.shortcode === 'FeedAlien')).toBe(false)
  })

  it('нераспознанный sort не роняет запрос — тихо падает на added', async () => {
    // ORDER — Record<ReelSort, ...>, но сам ReelSort — это только подсказка
    // компилятору: маршрут (route.ts) уже фильтрует значение своим белым
    // списком, а этот тест проверяет запрос независимо от него — ORDER[sort]
    // без ?? ORDER.added уходит в SQL как undefined при любом значении вне
    // перечисления, если защиту маршрута когда-нибудь обойдут или упростят.
    const rows = await listReels(ownerId, 'garbage' as ReelSort)

    expect(rows).toHaveLength(5)
  })
})
