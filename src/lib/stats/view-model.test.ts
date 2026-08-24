import { describe, expect, it } from 'vitest'
import type { StatsOverview } from '@/db/queries/stats-overview'
import { toKpiTiles } from './view-model'

/**
 * Плитки KPI: строки БД → готовые строки для экрана.
 *
 * Главное правило проекта проверяется здесь построчно: ноль и «нет данных»
 * выглядят по-разному. Ноль рилсов — настоящий ноль, а сумма просмотров,
 * которую не из чего складывать, — прочерк.
 */

const NBSP = ' '
const MINUS = '−'

const overview = (patch: Partial<StatsOverview> = {}): StatsOverview => ({
  reelsCount: 5,
  totalViews: 100_000,
  avgViews: 20_000,
  erPercent: 8.3,
  growth7d: 12_000,
  ...patch,
})

const find = (tiles: ReturnType<typeof toKpiTiles>, label: string) =>
  tiles.find((tile) => tile.label === label)

describe('toKpiTiles — ноль это не «нет данных»', () => {
  it('у блогера без рилсов рилсов ноль, а просмотров нет вовсе', () => {
    const tiles = toKpiTiles({
      reelsCount: 0,
      totalViews: null,
      avgViews: null,
      erPercent: null,
      growth7d: null,
    })

    expect(find(tiles, 'Всего рилсов')?.value).toBe('0')
    expect(find(tiles, 'Просмотры')?.value).toBe('—')
  })

  it('ER в ноль процентов — это ноль, а не прочерк', () => {
    // Ноль процентов бывает у рилса с просмотрами и без единой реакции.
    const tiles = toKpiTiles(overview({ erPercent: 0 }))

    expect(find(tiles, 'Вовлечённость')?.value).toBe(`0${NBSP}%`)
  })

  it('ER без данных — прочерк, а не ноль', () => {
    const tiles = toKpiTiles(overview({ erPercent: null }))

    expect(find(tiles, 'Вовлечённость')?.value).toBe('—')
  })
})

describe('toKpiTiles — числа и точность', () => {
  it('крупные просмотры сокращает, точное число прячет в подсказку', () => {
    const tiles = toKpiTiles(overview({ totalViews: 1_245_903 }))
    const tile = find(tiles, 'Просмотры')

    expect(tile?.value).toBe(`1,2${NBSP}млн`)
    expect(tile?.title).toBe(`1${NBSP}245${NBSP}903`)
  })

  it('среднее подписывает числом рилсов со склонением', () => {
    expect(find(toKpiTiles(overview({ reelsCount: 1 })), 'В среднем')?.hint).toBe('на 1 рилс')
    expect(find(toKpiTiles(overview({ reelsCount: 2 })), 'В среднем')?.hint).toBe('на 2 рилса')
    expect(find(toKpiTiles(overview({ reelsCount: 5 })), 'В среднем')?.hint).toBe('на 5 рилсов')
    // 11–14 — исключение русского счёта.
    expect(find(toKpiTiles(overview({ reelsCount: 11 })), 'В среднем')?.hint).toBe('на 11 рилсов')
  })
})

describe('toKpiTiles — прирост за неделю', () => {
  it('плитки прироста нет вовсе, когда прироста не посчитать', () => {
    const tiles = toKpiTiles(overview({ growth7d: null }))

    // Не «+0»: ноль означал бы «не выросло», а честный ответ — «данных мало».
    expect(find(tiles, 'За неделю')).toBeUndefined()
  })

  it('рост помечается стрелкой вверх и знаком плюс', () => {
    const tile = find(toKpiTiles(overview({ growth7d: 12_000 })), 'За неделю')

    expect(tile?.value).toBe(`+12${NBSP}тыс.`)
    expect(tile?.trend).toBe('up')
  })

  it('падение помечается вниз и типографским минусом', () => {
    const tile = find(toKpiTiles(overview({ growth7d: -340 })), 'За неделю')

    expect(tile?.value).toBe(`${MINUS}340`)
    expect(tile?.trend).toBe('down')
  })

  it('нулевой прирост — это ноль без стрелки', () => {
    const tile = find(toKpiTiles(overview({ growth7d: 0 })), 'За неделю')

    expect(tile?.value).toBe('0')
    expect(tile?.trend).toBeUndefined()
  })
})
