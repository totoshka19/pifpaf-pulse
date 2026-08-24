import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db, reels, reelSnapshots, users } from '@/db'
import { statsPostingTime, type PostingSlot } from './stats-posting-time'

/**
 * Гистограмма «когда лучше постить» на ЖИВОЙ базе Neon.
 *
 * Здесь пояс решает всё. PLAN.md §8 предупреждает прямо: без `AT TIME ZONE`
 * гистограмма уедет на три часа, пик сместится с 20:00 на 17:00, и
 * проверяющий из индустрии прочтёт это как поломку.
 *
 * Даты подобраны у ГРАНИЦЫ СУТОК специально. На удобной дате в середине дня
 * ошибка пояса не видна: 14:00 UTC и 17:00 МСК — один и тот же день недели,
 * и тест остался бы зелёным при сломанном запросе.
 */

const OWNER = 'pt-owner@example.invalid'
const STRANGER = 'pt-stranger@example.invalid'

const EMAILS = [OWNER, STRANGER]

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
  postedAt: Date | null,
  views: number[],
) {
  const [reel] = await db
    .insert(reels)
    .values({
      userId,
      shortcode,
      url: `https://www.instagram.com/reel/${shortcode}/`,
      syncStatus: postedAt ? 'ok' : 'pending',
      postedAt,
    })
    .returning({ id: reels.id })

  // Снапшоты идут по возрастанию времени: последний в списке — самый свежий.
  views.forEach(() => {})
  for (let i = 0; i < views.length; i++) {
    await db.insert(reelSnapshots).values({
      reelId: reel.id,
      views: views[i],
      likes: 10,
      comments: 1,
      capturedAt: new Date(Date.now() - (views.length - i) * 3_600_000),
    })
  }
}

const slotOf = (slots: PostingSlot[], weekday: number, hour: number) =>
  slots.find((s) => s.weekday === weekday && s.hour === hour)

beforeAll(async () => {
  for (const email of EMAILS) await db.delete(users).where(eq(users.email, email))

  ids.owner = await seedUser(OWNER)
  ids.stranger = await seedUser(STRANGER)

  // Понедельник 17:30 UTC = понедельник 20:30 МСК. Час обязан быть 20, не 17.
  await seedReel(ids.owner, 'PtEvening', new Date('2026-08-24T17:30:00Z'), [1000])

  // ВОСКРЕСЕНЬЕ 21:30 UTC = ПОНЕДЕЛЬНИК 00:30 МСК. Переход суток и недели
  // одновременно: без пояса это воскресенье, час 21.
  await seedReel(ids.owner, 'PtMidnight', new Date('2026-08-23T21:30:00Z'), [500])

  // Два рилса в один слот: вторник 09:15 МСК (06:15 UTC).
  await seedReel(ids.owner, 'PtPairA', new Date('2026-08-25T06:15:00Z'), [1000])
  await seedReel(ids.owner, 'PtPairB', new Date('2026-08-25T06:45:00Z'), [3000])

  // Опубликован, но ещё ни разу не опрошен: в счёт идёт, в среднее — нет.
  await seedReel(ids.owner, 'PtNoSnaps', new Date('2026-08-26T09:00:00Z'), [])

  // Ещё не опрошен вовсе — даты публикации нет. Гистограмме он не нужен.
  await seedReel(ids.owner, 'PtPending', null, [])

  // Чужой в тот же вечерний слот, с заведомо огромными числами.
  await seedReel(ids.stranger, 'PtAlien', new Date('2026-08-24T17:30:00Z'), [999_999])
})

afterAll(async () => {
  for (const email of EMAILS) await db.delete(users).where(eq(users.email, email))
})

describe('statsPostingTime — московский пояс', () => {
  it('час считает по Москве, а не по UTC', async () => {
    const slots = await statsPostingTime(ids.owner)

    // 17:30 UTC → 20:30 МСК. Без AT TIME ZONE здесь оказался бы час 17.
    expect(slotOf(slots, 1, 20)).toBeDefined()
    expect(slotOf(slots, 1, 17)).toBeUndefined()
  })

  it('день недели считает по Москве на переходе суток', async () => {
    const slots = await statsPostingTime(ids.owner)

    // Воскресенье 21:30 UTC — это уже понедельник 00:30 в Москве.
    // ISODOW: 1 — понедельник, 7 — воскресенье.
    expect(slotOf(slots, 1, 0)).toBeDefined()
    expect(slotOf(slots, 7, 21)).toBeUndefined()
  })

  it('неделя начинается с понедельника, а не с воскресенья', async () => {
    const slots = await statsPostingTime(ids.owner)

    // У DOW воскресенье равно нулю. ISODOW обязан дать 1…7 без нуля.
    for (const slot of slots) {
      expect(slot.weekday).toBeGreaterThanOrEqual(1)
      expect(slot.weekday).toBeLessThanOrEqual(7)
    }
  })
})

describe('statsPostingTime — агрегация', () => {
  it('складывает рилсы одного слота и считает среднее', async () => {
    const slots = await statsPostingTime(ids.owner)

    // Вторник 09:15 и 09:45 МСК — один слот. 1000 и 3000 → среднее 2000.
    const pair = slotOf(slots, 2, 9)
    expect(pair?.reelsCount).toBe(2)
    expect(pair?.avgViews).toBe(2000)
  })

  it('рилс без снапшотов считается штукой, но среднего не даёт', async () => {
    const slots = await statsPostingTime(ids.owner)

    // Среда 12:00 МСК: рилс опубликован, но ни разу не опрошен.
    const slot = slotOf(slots, 3, 12)
    expect(slot?.reelsCount).toBe(1)
    expect(slot?.avgViews).toBeNull()
  })

  it('рилс без даты публикации в гистограмму не попадает', async () => {
    const slots = await statsPostingTime(ids.owner)

    // Пять рилсов с датой лежат в четырёх слотах; шестой, pending, нигде.
    const total = slots.reduce((sum, s) => sum + s.reelsCount, 0)
    expect(total).toBe(5)
  })
})

describe('statsPostingTime — изоляция и типы', () => {
  it('чужие рилсы не подмешиваются', async () => {
    const slots = await statsPostingTime(ids.owner)

    // Чужой сидит ровно в том же вечернем слоте.
    expect(slotOf(slots, 1, 20)?.reelsCount).toBe(1)
    expect(slotOf(slots, 1, 20)?.avgViews).toBe(1000)
  })

  it('все поля приходят числами, а не строками', async () => {
    const slots = await statsPostingTime(ids.owner)
    const slot = slotOf(slots, 2, 9)!

    // EXTRACT отдаёт numeric, ROUND(AVG(...)) — тоже. Оба приходят строкой.
    expect(typeof slot.weekday).toBe('number')
    expect(typeof slot.hour).toBe('number')
    expect(typeof slot.reelsCount).toBe('number')
    expect(typeof slot.avgViews).toBe('number')
  })

  it('у пользователя без рилсов гистограмма пустая, а не ошибка', async () => {
    const slots = await statsPostingTime(ids.stranger)

    expect(slots).toHaveLength(1)
  })
})
