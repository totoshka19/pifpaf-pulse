import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db, reels, reelSnapshots, users } from '@/db'
import { statsOverview } from './stats-overview'

/**
 * KPI кабинета на ЖИВОЙ базе Neon.
 *
 * Главное, что проверяется здесь и не проверяется нигде больше, — разница
 * между «ноль» и «нет данных». Блогер без рилсов должен увидеть 0 рилсов
 * (настоящий ноль) и «—» в просмотрах (суммы не существует). Показать там
 * ноль просмотров значит соврать: ноль — это когда рилс есть, а просмотров
 * у него нет.
 *
 * Второе — типы. `db.execute` отдаёт BIGINT и NUMERIC строками; в срезе 5
 * это уже роняло ленту, причём молча.
 */

const OWNER = 'kpi-owner@example.invalid'
const STRANGER = 'kpi-stranger@example.invalid'
const EMPTY = 'kpi-empty@example.invalid'
const HIDDEN = 'kpi-hidden@example.invalid'
const ZERO = 'kpi-zero@example.invalid'
const GROWN = 'kpi-grown@example.invalid'

const EMAILS = [OWNER, STRANGER, EMPTY, HIDDEN, ZERO, GROWN]

const DAY = 86_400_000
const ago = (days: number) => new Date(Date.now() - days * DAY)

const ids: Record<string, string> = {}

async function seedUser(email: string): Promise<string> {
  const [user] = await db
    .insert(users)
    .values({ email, passwordHash: 'x', displayName: 'Тест' })
    .returning({ id: users.id })
  return user.id
}

type Snap = { views: number | null; likes?: number | null; comments?: number | null; at: Date }

async function seedReel(userId: string, shortcode: string, snapshots: Snap[]): Promise<string> {
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

  for (const s of snapshots) {
    await db.insert(reelSnapshots).values({
      reelId: reel.id,
      views: s.views,
      likes: s.likes === undefined ? 100 : s.likes,
      comments: s.comments === undefined ? 10 : s.comments,
      capturedAt: s.at,
    })
  }

  return reel.id
}

beforeAll(async () => {
  for (const email of EMAILS) await db.delete(users).where(eq(users.email, email))

  ids.owner = await seedUser(OWNER)
  ids.stranger = await seedUser(STRANGER)
  ids.empty = await seedUser(EMPTY)
  ids.hidden = await seedUser(HIDDEN)
  ids.zero = await seedUser(ZERO)
  ids.grown = await seedUser(GROWN)

  // Владелец: два рилса, последние снапшоты 1000 и 3000 просмотров.
  // Более ранние точки специально крупнее нуля — если запрос возьмёт не
  // последнюю, сумма не сойдётся.
  await seedReel(ids.owner, 'KpiOwnerA', [
    { views: 400, likes: 10, comments: 1, at: ago(8) },
    { views: 1000, likes: 90, comments: 10, at: ago(1) },
  ])
  await seedReel(ids.owner, 'KpiOwnerB', [
    { views: 900, likes: 20, comments: 2, at: ago(8) },
    { views: 3000, likes: 210, comments: 20, at: ago(1) },
  ])

  // Чужой: числа заведомо огромные, чтобы подмешивание было видно сразу.
  await seedReel(ids.stranger, 'KpiAlien', [{ views: 999_999, at: ago(1) }])

  // Рилс есть, снапшотов нет — так выглядит только что добавленная ссылка.
  ids.noSnaps = await seedReel(ids.hidden, 'KpiNoSnaps', [])

  // Скрытые лайки: Instagram отдаёт -1, нормализация превращает это в null.
  await seedReel(ids.hidden, 'KpiHidden', [
    { views: 5000, likes: null, comments: 50, at: ago(1) },
  ])

  // Ноль просмотров: NULLIF обязан спасти от деления на ноль.
  await seedReel(ids.zero, 'KpiZero', [{ views: 0, likes: 0, comments: 0, at: ago(1) }])

  // Прирост за неделю. Обе точки ВНУТРИ окна — только тогда он считается.
  await seedReel(ids.grown, 'KpiGrewA', [
    { views: 1000, at: ago(5) },
    { views: 2500, at: ago(1) },
  ])
  await seedReel(ids.grown, 'KpiGrewB', [
    { views: 500, at: ago(6) },
    { views: 800, at: ago(2) },
  ])
  // Одна точка в окне: честного прироста нет, и в сумму рилс не вносит ноль.
  await seedReel(ids.grown, 'KpiGrewOne', [{ views: 7777, at: ago(3) }])
  // Обе точки старше недели: в окно не попадают вовсе.
  await seedReel(ids.grown, 'KpiGrewOld', [
    { views: 100, at: ago(30) },
    { views: 9000, at: ago(20) },
  ])
})

afterAll(async () => {
  for (const email of EMAILS) await db.delete(users).where(eq(users.email, email))
})

describe('statsOverview — «нет данных» это не ноль', () => {
  it('у блогера без рилсов ноль рилсов, а остальное — null', async () => {
    const kpi = await statsOverview(ids.empty)

    expect(kpi.reelsCount).toBe(0)
    expect(kpi.totalViews).toBeNull()
    expect(kpi.avgViews).toBeNull()
    expect(kpi.erPercent).toBeNull()
    expect(kpi.growth7d).toBeNull()
  })

  it('среднее считается по рилсам С ДАННЫМИ, и это число видно наружу', async () => {
    // У этого пользователя два рилса, просмотры есть только у одного.
    // AVG в SQL пропускает NULL — то есть делит на 1, а не на 2. Это
    // арифметически верно (усреднять нечего), но подпись «на 2 рилса»
    // рядом со средним заставила бы читателя делить самому и не сойтись.
    // Поэтому запрос обязан сказать, СКОЛЬКО рилсов реально участвовало.
    const kpi = await statsOverview(ids.hidden)

    expect(kpi.reelsCount).toBe(2)
    expect(kpi.reelsWithViews).toBe(1)
    expect(kpi.avgViews).toBe(5000)
  })

  it('reelsWithViews равен нулю, когда данных нет ни у кого', async () => {
    expect((await statsOverview(ids.empty)).reelsWithViews).toBe(0)
  })

  it('рилс без снапшотов считается штукой, но не просмотрами', async () => {
    // У этого пользователя два рилса: один вовсе без снапшотов, второй со
    // скрытыми лайками. Пустой обязан попасть в счёт, но не в сумму.
    const kpi = await statsOverview(ids.hidden)

    expect(kpi.reelsCount).toBe(2)
    expect(kpi.totalViews).toBe(5000)
  })
})

describe('statsOverview — арифметика', () => {
  it('складывает ПОСЛЕДНИЕ снапшоты, а не все подряд', async () => {
    const kpi = await statsOverview(ids.owner)

    // 1000 + 3000. Если запрос просуммирует все снапшоты, получится 5300.
    expect(kpi.totalViews).toBe(4000)
  })

  it('среднее считает по числу рилсов', async () => {
    const kpi = await statsOverview(ids.owner)

    expect(kpi.reelsCount).toBe(2)
    expect(kpi.avgViews).toBe(2000)
  })

  it('ER считает от реакций к просмотрам', async () => {
    const kpi = await statsOverview(ids.owner)

    // (90 + 10 + 210 + 20) / 4000 = 330 / 4000 = 8.25% → округление до 8.3
    expect(kpi.erPercent).toBeCloseTo(8.3, 1)
  })

  it('скрытые лайки не превращаются в ноль', async () => {
    const kpi = await statsOverview(ids.hidden)

    // Единственный рилс с данными: likes = null, comments = 50, views = 5000.
    // Если null сложить как ноль, выйдет 50/5000 = 1.0%.
    // Честный ответ — считать ER не из чего: лайков нет как числа.
    expect(kpi.erPercent).not.toBe(1)
  })

  it('ноль просмотров не роняет запрос делением на ноль', async () => {
    const kpi = await statsOverview(ids.zero)

    expect(kpi.reelsCount).toBe(1)
    expect(kpi.totalViews).toBe(0)
    expect(kpi.erPercent).toBeNull()
  })
})

describe('statsOverview — прирост за 7 дней', () => {
  it('складывает прирост по всем рилсам с двумя точками в окне', async () => {
    const kpi = await statsOverview(ids.grown)

    // (2500 - 1000) + (800 - 500) = 1800.
    // Рилс с одной точкой в окне и рилс целиком за окном не участвуют.
    expect(kpi.growth7d).toBe(1800)
  })

  it('прирост — null, когда ни у одного рилса нет двух точек в окне', async () => {
    // У владельца обе ранние точки старше недели, свежая — одна на рилс.
    const kpi = await statsOverview(ids.owner)

    expect(kpi.growth7d).toBeNull()
  })

  it('прирост приходит числом', async () => {
    const kpi = await statsOverview(ids.grown)

    expect(typeof kpi.growth7d).toBe('number')
  })
})

describe('statsOverview — изоляция и типы', () => {
  it('чужие рилсы не подмешиваются', async () => {
    const kpi = await statsOverview(ids.owner)

    expect(kpi.reelsCount).toBe(2)
    expect(kpi.totalViews).toBe(4000)
    expect(kpi.totalViews).not.toBe(1_003_999)
  })

  it('все числа приходят числами, а не строками', async () => {
    const kpi = await statsOverview(ids.owner)

    // Замер 2026-08-24: db.execute отдаёт bigint и numeric СТРОКОЙ.
    // Без приведения интерфейс молча покажет «—» вместо цифр.
    expect(typeof kpi.reelsCount).toBe('number')
    expect(typeof kpi.totalViews).toBe('number')
    expect(typeof kpi.avgViews).toBe('number')
    expect(typeof kpi.erPercent).toBe('number')
  })
})
