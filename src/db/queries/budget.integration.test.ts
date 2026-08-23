import { sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db'
import { monthlyCap } from '@/lib/apify/budget'
import { tryReserve, usage } from './budget'

/**
 * Проверка предохранителя бюджета на ЖИВОЙ базе.
 *
 * Юнит-тесты рядом проверяют формат периода и чтение лимита. Гонку они поймать
 * не могут в принципе: она возникает только при параллельных запросах к настоящему
 * Postgres. Если условие «влезаем в лимит» уедет из SQL в JavaScript, все
 * параллельные вызовы прочитают одно значение и одновременно решат, что бюджет есть.
 *
 * Работаем в заведомо нерабочем периоде и подменяем `now`, чтобы не задеть
 * настоящий счётчик.
 */

const CAP = monthlyCap()
const PARALLEL = 10

/** 15 декабря 1999 в MSK → период '1999-12'. С рабочими данными не пересекается. */
const TEST_NOW = new Date('1999-12-15T00:00:00Z')
const TEST_PERIOD = '1999-12'

async function reset(results: number) {
  await db.execute(sql`DELETE FROM apify_usage WHERE period = ${TEST_PERIOD}`)
  if (results > 0) {
    await db.execute(
      sql`INSERT INTO apify_usage (period, results) VALUES (${TEST_PERIOD}, ${results})`,
    )
  }
}

beforeEach(async () => {
  await reset(0)
})

afterAll(async () => {
  await db.execute(sql`DELETE FROM apify_usage WHERE period = ${TEST_PERIOD}`)
})

describe('tryReserve — арбитром выступает база, а не приложение', () => {
  it('из десяти параллельных резерваций на последний результат проходит ровно одна', async () => {
    await reset(CAP - 1)

    const results = await Promise.all(
      Array.from({ length: PARALLEL }, () => tryReserve(1, TEST_NOW)),
    )

    expect(results.filter(Boolean)).toHaveLength(1)

    const after = await usage(TEST_NOW)
    expect(after.used).toBe(CAP)
    expect(after.left).toBe(0)
  })

  it('счётчик не перескакивает лимит при параллельной нагрузке', async () => {
    await reset(CAP - 3)

    await Promise.all(Array.from({ length: PARALLEL }, () => tryReserve(1, TEST_NOW)))

    const after = await usage(TEST_NOW)
    expect(after.used).toBeLessThanOrEqual(CAP)
    expect(after.used).toBe(CAP)
  })
})

describe('tryReserve — обычный путь', () => {
  it('в пустом периоде резервирует и заводит строку', async () => {
    expect(await tryReserve(5, TEST_NOW)).toBe(true)
    expect((await usage(TEST_NOW)).used).toBe(5)
  })

  it('накапливает расход', async () => {
    await tryReserve(5, TEST_NOW)
    await tryReserve(3, TEST_NOW)
    expect((await usage(TEST_NOW)).used).toBe(8)
  })

  it('отклоняет то, что не влезает, и НЕ увеличивает счётчик', async () => {
    await reset(CAP - 2)

    expect(await tryReserve(5, TEST_NOW)).toBe(false)
    expect((await usage(TEST_NOW)).used).toBe(CAP - 2)
  })

  it('пропускает запрос ровно на остаток', async () => {
    await reset(CAP - 2)

    expect(await tryReserve(2, TEST_NOW)).toBe(true)
    expect((await usage(TEST_NOW)).used).toBe(CAP)
  })
})

describe('tryReserve — негодные аргументы', () => {
  it('нулевой и отрицательный запрос отклоняет', async () => {
    expect(await tryReserve(0, TEST_NOW)).toBe(false)
    expect(await tryReserve(-1, TEST_NOW)).toBe(false)
  })

  it('запрос больше всего лимита отклоняет даже в пустом периоде', async () => {
    // Первая вставка идёт мимо ON CONFLICT, и WHERE к ней не применяется —
    // без явной проверки такой запрос прошёл бы и сразу выбил лимит.
    expect(await tryReserve(CAP + 1, TEST_NOW)).toBe(false)
    expect((await usage(TEST_NOW)).used).toBe(0)
  })
})

describe('usage', () => {
  it('в пустом периоде отдаёт нули и полный остаток', async () => {
    const u = await usage(TEST_NOW)
    expect(u).toEqual({ period: TEST_PERIOD, used: 0, cap: CAP, left: CAP })
  })
})
