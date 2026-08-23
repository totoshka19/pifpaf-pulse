import { describe, expect, it } from 'vitest'
import { computeNextSyncAt } from './schedule'

const NOW = new Date('2026-08-23T12:00:00.000Z')
const hoursBetween = (a: Date, b: Date) => (b.getTime() - a.getTime()) / 3_600_000
const agoHours = (h: number) => new Date(NOW.getTime() - h * 3_600_000)

describe('computeNextSyncAt — интервал зависит от возраста рилса', () => {
  const cases: [string, Date, number][] = [
    ['только опубликован', agoHours(0.1), 1],
    ['свежий, 1 час', agoHours(1), 1],
    ['на границе 48 часов', agoHours(47), 1],
    ['ровно 48 часов — уже следующая ступень', agoHours(48), 6],
    ['3 дня', agoHours(72), 6],
    ['на границе недели', agoHours(24 * 6), 6],
    ['ровно неделя', agoHours(24 * 7), 24],
    ['две недели', agoHours(24 * 14), 24],
    ['на границе месяца', agoHours(24 * 29), 24],
    ['ровно месяц', agoHours(24 * 30), 24 * 7],
    ['полгода', agoHours(24 * 180), 24 * 7],
  ]

  it.each(cases)('%s → следующий опрос через %d ч', (_name, postedAt, expected) => {
    expect(hoursBetween(NOW, computeNextSyncAt(postedAt, NOW))).toBeCloseTo(expected, 5)
  })
})

describe('computeNextSyncAt — граничные случаи', () => {
  it('без даты публикации считает рилс свежим', () => {
    // Дата ещё не пришла (sync_status='pending'). Опросить скоро — она появится.
    expect(hoursBetween(NOW, computeNextSyncAt(null, NOW))).toBeCloseTo(1, 5)
  })

  it('дата из будущего не ломает расчёт', () => {
    const future = new Date(NOW.getTime() + 3_600_000)
    expect(hoursBetween(NOW, computeNextSyncAt(future, NOW))).toBeCloseTo(1, 5)
  })

  it('всегда возвращает момент в будущем', () => {
    for (const h of [0, 1, 100, 10_000, 100_000]) {
      expect(computeNextSyncAt(agoHours(h), NOW).getTime()).toBeGreaterThan(NOW.getTime())
    }
  })

  it('не мутирует переданные даты', () => {
    const posted = agoHours(10)
    const postedCopy = new Date(posted)
    const nowCopy = new Date(NOW)

    computeNextSyncAt(posted, NOW)

    expect(posted.getTime()).toBe(postedCopy.getTime())
    expect(NOW.getTime()).toBe(nowCopy.getTime())
  })
})

describe('computeNextSyncAt — расход бюджета', () => {
  it('месячный рилс опрашивается на порядок реже свежего', () => {
    const fresh = hoursBetween(NOW, computeNextSyncAt(agoHours(1), NOW))
    const old = hoursBetween(NOW, computeNextSyncAt(agoHours(24 * 60), NOW))

    // Смысл всей лестницы: PLAN.md §7, 520 результатов в месяц вместо 43 200.
    expect(old / fresh).toBeGreaterThanOrEqual(24)
  })
})
