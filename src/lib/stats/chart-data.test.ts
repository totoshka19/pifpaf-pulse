import { describe, expect, it } from 'vitest'
import type { PostingSlot } from '@/db/queries/stats-posting-time'
import { toGrowthSeries, toPostingHeatmap, toViewsSeries } from './chart-data'

/**
 * Подготовка рядов для Recharts.
 *
 * Всё считается ЗДЕСЬ, на сервере, и приезжает в график строками и числами.
 * Отдать графику `Date` значит дать браузеру отформатировать её своим поясом
 * — и московское время, ради которого написан весь SQL, потеряется на
 * последнем шаге.
 */

const NBSP = ' '

describe('toViewsSeries', () => {
  it('подписывает день коротким московским форматом', () => {
    const series = toViewsSeries([{ day: '2026-08-24', totalViews: 1000 }])

    expect(series[0].label).toBe('24 авг')
  })

  it('день берётся из строки как есть, без обратного превращения в Date', () => {
    // 1 января — та дата, на которой пояс сдвинул бы и месяц, и год.
    const series = toViewsSeries([{ day: '2026-01-01', totalViews: 5 }])

    expect(series[0].label).toBe('1 янв')
  })

  it('точное число прячет в подпись для тултипа', () => {
    const series = toViewsSeries([{ day: '2026-08-24', totalViews: 1_245_903 }])

    expect(series[0].value).toBe(1_245_903)
    expect(series[0].title).toBe(`1${NBSP}245${NBSP}903`)
  })

  it('пустой ряд не роняет и не выдумывает точек', () => {
    expect(toViewsSeries([])).toEqual([])
  })

  it('сохраняет порядок дней', () => {
    const series = toViewsSeries([
      { day: '2026-08-22', totalViews: 1 },
      { day: '2026-08-23', totalViews: 2 },
      { day: '2026-08-24', totalViews: 3 },
    ])

    expect(series.map((p) => p.label)).toEqual(['22 авг', '23 авг', '24 авг'])
  })
})

const slot = (weekday: number, hour: number, reelsCount: number, avgViews: number | null): PostingSlot => ({
  weekday,
  hour,
  reelsCount,
  avgViews,
})

describe('toPostingHeatmap — форма сетки', () => {
  it('отдаёт семь строк, даже если данных всего в двух слотах', () => {
    const grid = toPostingHeatmap([slot(1, 20, 1, 1000), slot(3, 9, 1, 500)])

    expect(grid).toHaveLength(7)
  })

  it('неделя начинается с понедельника', () => {
    const grid = toPostingHeatmap([])

    expect(grid.map((row) => row.label)).toEqual(['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'])
    expect(grid.map((row) => row.weekday)).toEqual([1, 2, 3, 4, 5, 6, 7])
  })

  it('в каждой строке все двадцать четыре часа', () => {
    const grid = toPostingHeatmap([slot(1, 20, 1, 1000)])

    for (const row of grid) {
      expect(row.hours).toHaveLength(24)
      expect(row.hours.map((h) => h.hour)).toEqual([...Array(24).keys()])
    }
  })

  it('слот без данных пустой, но существует', () => {
    const grid = toPostingHeatmap([slot(1, 20, 1, 1000)])
    const empty = grid[0].hours[0]

    expect(empty.reelsCount).toBe(0)
    expect(empty.avgViews).toBeNull()
    expect(empty.intensity).toBe(0)
  })

  it('данные встают в свой слот', () => {
    const grid = toPostingHeatmap([slot(3, 9, 2, 500)])
    const cell = grid[2].hours[9]

    expect(cell.reelsCount).toBe(2)
    expect(cell.avgViews).toBe(500)
  })
})

describe('toPostingHeatmap — насыщенность', () => {
  it('нормирует от нуля до единицы по максимуму набора', () => {
    const grid = toPostingHeatmap([
      slot(1, 20, 1, 1000),
      slot(2, 10, 1, 500),
      slot(3, 8, 1, 250),
    ])

    expect(grid[0].hours[20].intensity).toBe(1)
    expect(grid[1].hours[10].intensity).toBe(0.5)
    expect(grid[2].hours[8].intensity).toBe(0.25)
  })

  it('одинаковые значения не делят на ноль', () => {
    const grid = toPostingHeatmap([slot(1, 9, 1, 700), slot(2, 9, 1, 700)])

    // Наивная нормировка (v − min) / (max − min) дала бы здесь NaN.
    expect(grid[0].hours[9].intensity).toBe(1)
    expect(grid[1].hours[9].intensity).toBe(1)
    expect(Number.isNaN(grid[0].hours[9].intensity)).toBe(false)
  })

  it('единственный слот не делит на ноль', () => {
    const grid = toPostingHeatmap([slot(5, 18, 1, 42)])

    expect(grid[4].hours[18].intensity).toBe(1)
  })

  it('слоты со скрытыми просмотрами не роняют нормировку', () => {
    // Рилс опубликован, но ни разу не опрошен: слот есть, среднего нет.
    const grid = toPostingHeatmap([slot(1, 9, 1, null), slot(2, 9, 1, 800)])

    expect(grid[0].hours[9].reelsCount).toBe(1)
    expect(grid[0].hours[9].avgViews).toBeNull()
    expect(grid[0].hours[9].intensity).toBe(0)
    expect(grid[1].hours[9].intensity).toBe(1)
  })

  it('когда просмотров нет нигде, насыщенность везде нулевая', () => {
    const grid = toPostingHeatmap([slot(1, 9, 1, null), slot(2, 9, 1, null)])

    expect(grid[0].hours[9].intensity).toBe(0)
    expect(grid[1].hours[9].intensity).toBe(0)
  })

  it('пустой набор даёт пустую сетку без исключения', () => {
    const grid = toPostingHeatmap([])

    expect(grid).toHaveLength(7)
    expect(grid.every((row) => row.hours.every((h) => h.intensity === 0))).toBe(true)
  })
})

describe('toGrowthSeries — график роста одного рилса', () => {
  const snap = (iso: string, views: number | null) => ({
    capturedAt: new Date(iso),
    views,
    likes: 10,
    comments: 1,
  })

  it('подписывает точку днём и часом по Москве', () => {
    // 16:30 UTC = 19:30 МСК.
    const series = toGrowthSeries([snap('2026-08-24T16:30:00Z', 1000)])

    expect(series[0].label).toBe('24 авг, 19:30')
  })

  it('точное число прячет в подпись для тултипа', () => {
    const series = toGrowthSeries([snap('2026-08-24T16:30:00Z', 1_245_903)])

    expect(series[0].value).toBe(1_245_903)
    expect(series[0].title).toBe(`1${NBSP}245${NBSP}903`)
  })

  it('снапшот со скрытыми просмотрами в график не попадает', () => {
    // null — это «Instagram не отдал число», а не ноль. Точка на нуле
    // нарисовала бы обвал, которого не было.
    const series = toGrowthSeries([
      snap('2026-08-23T16:30:00Z', 1000),
      snap('2026-08-24T16:30:00Z', null),
    ])

    expect(series).toHaveLength(1)
    expect(series[0].value).toBe(1000)
  })

  it('пустой список не роняет', () => {
    expect(toGrowthSeries([])).toEqual([])
  })
})
