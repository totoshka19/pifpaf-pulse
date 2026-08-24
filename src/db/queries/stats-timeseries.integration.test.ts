import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db, reels, reelSnapshots, users } from '@/db'
import { statsTimeseries } from './stats-timeseries'

/**
 * Динамика просмотров по дням — на ЖИВОЙ базе Neon.
 *
 * Здесь чинятся оба бага запроса из PLAN.md §8, и здесь же они охраняются:
 * двойной счёт снапшотов за день и провалы графика в дни неполного опроса.
 *
 * Календарь — МОСКОВСКИЙ. Снапшоты сеются с явными моментами, посчитанными
 * от «сегодня в Москве», а не от локального времени машины: иначе тест
 * падал бы три часа в сутки, когда даты в UTC и в МСК расходятся.
 */

const DEDUP = 'ts-dedup@example.invalid'
const SUMMED = 'ts-sum@example.invalid'
const CARRY = 'ts-carry@example.invalid'
const FRESH = 'ts-fresh@example.invalid'
const EMPTY = 'ts-empty@example.invalid'
const RANGE = 'ts-range@example.invalid'
const STRANGER = 'ts-stranger@example.invalid'

const EMAILS = [DEDUP, SUMMED, CARRY, FRESH, EMPTY, RANGE, STRANGER]

/** Москва — UTC+3 круглый год, перевода часов нет с 2014-го. */
const MSK_OFFSET_MS = 3 * 60 * 60 * 1000

/** Сегодняшняя дата ПО МОСКВЕ, разобранная на части. */
function mskToday() {
  const shifted = new Date(Date.now() + MSK_OFFSET_MS)
  return {
    y: shifted.getUTCFullYear(),
    m: shifted.getUTCMonth(),
    d: shifted.getUTCDate(),
  }
}

/** Момент времени: `hour` часов по МСК в день «сегодня минус daysAgo». */
function atMsk(daysAgo: number, hour: number): Date {
  const { y, m, d } = mskToday()
  return new Date(Date.UTC(y, m, d - daysAgo, hour, 0, 0) - MSK_OFFSET_MS)
}

/** Та же дата строкой «YYYY-MM-DD», как её отдаёт запрос. */
function mskDay(daysAgo: number): string {
  const { y, m, d } = mskToday()
  return new Date(Date.UTC(y, m, d - daysAgo)).toISOString().slice(0, 10)
}

const ids: Record<string, string> = {}

async function seedUser(email: string): Promise<string> {
  const [user] = await db
    .insert(users)
    .values({ email, passwordHash: 'x', displayName: 'Тест' })
    .returning({ id: users.id })
  return user.id
}

type Snap = { views: number; daysAgo: number; hour: number }

async function seedReel(userId: string, shortcode: string, snaps: Snap[]) {
  const [reel] = await db
    .insert(reels)
    .values({
      userId,
      shortcode,
      url: `https://www.instagram.com/reel/${shortcode}/`,
      syncStatus: 'ok',
      postedAt: atMsk(40, 12),
    })
    .returning({ id: reels.id })

  for (const s of snaps) {
    await db.insert(reelSnapshots).values({
      reelId: reel.id,
      views: s.views,
      likes: 10,
      comments: 1,
      capturedAt: atMsk(s.daysAgo, s.hour),
    })
  }
}

/** Точка за конкретный день или undefined, если дня в ряду нет. */
const dayOf = (points: { day: string; totalViews: number }[], daysAgo: number) =>
  points.find((p) => p.day === mskDay(daysAgo))

beforeAll(async () => {
  for (const email of EMAILS) await db.delete(users).where(eq(users.email, email))

  for (const email of EMAILS) ids[email] = await seedUser(email)

  // Опрошен дважды за один московский день: утром и вечером.
  await seedReel(ids[DEDUP], 'TsDedup', [
    { views: 1000, daysAgo: 3, hour: 8 },
    { views: 1200, daysAgo: 3, hour: 20 },
  ])

  // Чужой с заведомо огромными числами: подмешивание будет видно сразу.
  await seedReel(ids[STRANGER], 'TsAlien', [{ views: 999_999, daysAgo: 3, hour: 12 }])

  // Два рилса в один день: 1000 + 500.
  await seedReel(ids[SUMMED], 'TsSumA', [{ views: 1000, daysAgo: 3, hour: 12 }])
  await seedReel(ids[SUMMED], 'TsSumB', [{ views: 500, daysAgo: 3, hour: 12 }])

  // Дыра: снапшот шесть дней назад, следующий — три дня назад.
  // Дни −5 и −4 обязаны показать значение шестого дня, а не провалиться.
  await seedReel(ids[CARRY], 'TsCarry', [
    { views: 1000, daysAgo: 6, hour: 12 },
    { views: 4000, daysAgo: 3, hour: 12 },
  ])

  // Старый рилс плюс добавленный вчера. До первого снапшота новый рилс
  // не должен приписывать себе прошлые дни.
  await seedReel(ids[FRESH], 'TsFreshOld', [{ views: 1000, daysAgo: 10, hour: 12 }])
  await seedReel(ids[FRESH], 'TsFreshNew', [{ views: 500, daysAgo: 1, hour: 12 }])

  // Десять дней подряд — чтобы проверить длину диапазона.
  await seedReel(
    ids[RANGE],
    'TsRange',
    Array.from({ length: 10 }, (_, i) => ({ views: 100 * (10 - i), daysAgo: 9 - i, hour: 12 })),
  )
})

afterAll(async () => {
  for (const email of EMAILS) await db.delete(users).where(eq(users.email, email))
})

describe('statsTimeseries — двойной счёт из спеки §8', () => {
  it('за день берёт ПОСЛЕДНИЙ снапшот рилса, а не сумму всех', async () => {
    const points = await statsTimeseries(ids[DEDUP], '7d')

    // 1000 утром и 1200 вечером. Наивный SUM дал бы 2200 — числа,
    // которого никогда не существовало.
    expect(dayOf(points, 3)?.totalViews).toBe(1200)
  })

  it('складывает разные рилсы за один день', async () => {
    const points = await statsTimeseries(ids[SUMMED], '7d')

    expect(dayOf(points, 3)?.totalViews).toBe(1500)
  })
})

describe('statsTimeseries — протягивание значений', () => {
  it('в дни без опроса держит последнее известное значение', async () => {
    const points = await statsTimeseries(ids[CARRY], '7d')

    // Ключевой тест среза. Без протягивания дни −5 и −4 провалились бы,
    // а суммарные просмотры убывать не умеют.
    expect(dayOf(points, 6)?.totalViews).toBe(1000)
    expect(dayOf(points, 5)?.totalViews).toBe(1000)
    expect(dayOf(points, 4)?.totalViews).toBe(1000)
    expect(dayOf(points, 3)?.totalViews).toBe(4000)
  })

  it('протягивает вперёд до сегодняшнего дня', async () => {
    const points = await statsTimeseries(ids[CARRY], '7d')

    expect(dayOf(points, 0)?.totalViews).toBe(4000)
  })

  it('ряд не убывает ни в одной точке', async () => {
    const points = await statsTimeseries(ids[CARRY], '7d')

    for (let i = 1; i < points.length; i++) {
      expect(points[i].totalViews).toBeGreaterThanOrEqual(points[i - 1].totalViews)
    }
  })

  it('не тянет рилс назад, в дни до его первого снапшота', async () => {
    const points = await statsTimeseries(ids[FRESH], '30d')

    // Пять дней назад существовал только старый рилс.
    expect(dayOf(points, 5)?.totalViews).toBe(1000)
    // Вчера добавился новый — и только со вчера он в сумме.
    expect(dayOf(points, 1)?.totalViews).toBe(1500)
    expect(dayOf(points, 0)?.totalViews).toBe(1500)
  })
})

describe('statsTimeseries — диапазоны и границы', () => {
  it('7d отдаёт не больше семи точек и заканчивается сегодняшним днём', async () => {
    const points = await statsTimeseries(ids[RANGE], '7d')

    expect(points.length).toBeLessThanOrEqual(7)
    expect(points.at(-1)?.day).toBe(mskDay(0))
  })

  it('30d захватывает то, чего не видно в 7d', async () => {
    const week = await statsTimeseries(ids[RANGE], '7d')
    const month = await statsTimeseries(ids[RANGE], '30d')

    expect(month.length).toBeGreaterThan(week.length)
    expect(month.at(-1)?.day).toBe(mskDay(0))
  })

  it('all начинается с первого снапшота, а не раньше', async () => {
    const points = await statsTimeseries(ids[RANGE], 'all')

    expect(points[0]?.day).toBe(mskDay(9))
  })

  it('дни до первого снапшота отсутствуют, а не показывают ноль', async () => {
    // Найдено мутацией: без `WHERE views IS NOT NULL` запрос отдавал все
    // тридцать дней, и девятнадцать из них — нулями. График рисовал бы
    // три недели ровного нуля перед первыми данными, то есть врал бы:
    // «просмотров не было». Их не было не потому, что ноль, а потому,
    // что рилса ещё не существовало. AGENTS.md: нет данных — это «—», не 0.
    const points = await statsTimeseries(ids[FRESH], '30d')

    expect(points.every((p) => p.totalViews > 0)).toBe(true)
    // Первый снапшот этого пользователя — десять дней назад.
    expect(points[0]?.day).toBe(mskDay(10))
    expect(dayOf(points, 20)).toBeUndefined()
  })

  it('у пользователя без снапшотов ряд пустой, а не ошибка', async () => {
    const points = await statsTimeseries(ids[EMPTY], '30d')

    expect(points).toEqual([])
  })

  it('пустой ряд не роняет и режим all', async () => {
    const points = await statsTimeseries(ids[EMPTY], 'all')

    expect(points).toEqual([])
  })
})

describe('statsTimeseries — изоляция и типы', () => {
  it('чужие снапшоты в сумму не попадают', async () => {
    const points = await statsTimeseries(ids[DEDUP], '7d')

    for (const point of points) {
      expect(point.totalViews).toBeLessThan(999_999)
    }
  })

  it('totalViews приходит числом, а день — строкой', async () => {
    const points = await statsTimeseries(ids[DEDUP], '7d')

    expect(typeof points[0].totalViews).toBe('number')
    expect(typeof points[0].day).toBe('string')
    expect(points[0].day).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
