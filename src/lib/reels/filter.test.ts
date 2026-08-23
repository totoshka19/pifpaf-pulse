import { describe, expect, it } from 'vitest'
import type { ReelListRow } from '@/db/queries/list-reels'
import { applyFeed, DEFAULT_FEED_STATE, type FeedState } from './filter'

const NOW = new Date('2026-08-24T16:30:00Z')
const DAY = 86_400_000
const ago = (days: number) => new Date(NOW.getTime() - days * DAY)

function row(patch: Partial<ReelListRow> & { id: string }): ReelListRow {
  return {
    shortcode: 'Cxxxxxx',
    url: 'https://www.instagram.com/reel/Cxxxxxx/',
    caption: null,
    ownerUsername: 'pifpafai',
    thumbnailSrc: null,
    postedAt: ago(1),
    syncStatus: 'ok',
    syncError: null,
    lastSyncedAt: ago(0),
    views: 1000,
    likes: 10,
    comments: 1,
    capturedAt: ago(0),
    createdAt: ago(1),
    growth7d: null,
    ...patch,
  }
}

const state = (patch: Partial<FeedState> = {}): FeedState => ({
  ...DEFAULT_FEED_STATE,
  ...patch,
})

describe('applyFeed — поиск', () => {
  const rows = [
    row({ id: 'a', caption: 'Рецепт БОРЩА за 10 минут' }),
    row({ id: 'b', caption: 'Тренировка дома' }),
    row({ id: 'c', caption: null, ownerUsername: 'borsch_master' }),
  ]

  it('находит по подписи без учёта регистра', () => {
    const found = applyFeed(rows, state({ text: 'борща' }), NOW)

    expect(found.map((r) => r.id)).toEqual(['a'])
  })

  it('ищет и по автору', () => {
    const found = applyFeed(rows, state({ text: 'borsch' }), NOW)

    expect(found.map((r) => r.id)).toEqual(['c'])
  })

  it('пробелы по краям запроса не мешают', () => {
    expect(applyFeed(rows, state({ text: '  дома  ' }), NOW)).toHaveLength(1)
  })

  it('пустой запрос не фильтрует ничего', () => {
    expect(applyFeed(rows, state({ text: '' }), NOW)).toHaveLength(3)
  })

  it('рилс без подписи не роняет поиск', () => {
    expect(() => applyFeed(rows, state({ text: 'что-то' }), NOW)).not.toThrow()
  })
})

describe('applyFeed — период', () => {
  const rows = [
    row({ id: 'fresh', postedAt: ago(2) }),
    row({ id: 'month', postedAt: ago(20) }),
    row({ id: 'old', postedAt: ago(90) }),
    row({ id: 'pending', postedAt: null }),
  ]

  it('семь дней оставляют только свежее', () => {
    const found = applyFeed(rows, state({ range: '7d' }), NOW)

    expect(found.map((r) => r.id).sort()).toEqual(['fresh', 'pending'])
  })

  it('тридцать дней захватывают месяц', () => {
    const found = applyFeed(rows, state({ range: '30d' }), NOW)

    expect(found.map((r) => r.id)).toContain('month')
    expect(found.map((r) => r.id)).not.toContain('old')
  })

  it('рилс без даты виден при любом периоде', () => {
    // Блогер только что вставил ссылку; спрятать его карточку фильтром —
    // значит показать, что добавление «не сработало».
    expect(applyFeed(rows, state({ range: '7d' }), NOW).map((r) => r.id)).toContain('pending')
    expect(applyFeed(rows, state({ range: '30d' }), NOW).map((r) => r.id)).toContain('pending')
  })
})

describe('applyFeed — сортировка', () => {
  const rows = [
    row({ id: 'low', views: 100, growth7d: null, postedAt: ago(1), createdAt: ago(1) }),
    row({ id: 'high', views: 900, growth7d: 50, postedAt: ago(5), createdAt: ago(5) }),
    row({ id: 'none', views: null, growth7d: 700, postedAt: null, createdAt: ago(0) }),
  ]

  it('по просмотрам — от больших, пустые в конце', () => {
    expect(applyFeed(rows, state({ sort: 'views' }), NOW).map((r) => r.id)).toEqual([
      'high',
      'low',
      'none',
    ])
  })

  it('по росту — от большего, «мало данных» в конце', () => {
    expect(applyFeed(rows, state({ sort: 'growth' }), NOW).map((r) => r.id)).toEqual([
      'none',
      'high',
      'low',
    ])
  })

  it('по дате публикации — свежие сверху, без даты в конце', () => {
    expect(applyFeed(rows, state({ sort: 'date' }), NOW).map((r) => r.id)).toEqual([
      'low',
      'high',
      'none',
    ])
  })

  it('по добавлению — последний добавленный сверху', () => {
    expect(applyFeed(rows, state({ sort: 'added' }), NOW).map((r) => r.id)).toEqual([
      'none',
      'low',
      'high',
    ])
  })

  it('исходный массив не мутируется', () => {
    // rows приходят из состояния React: сортировка на месте сломала бы
    // сравнение ссылок и дала бы пропущенную перерисовку.
    const before = rows.map((r) => r.id)
    applyFeed(rows, state({ sort: 'views' }), NOW)

    expect(rows.map((r) => r.id)).toEqual(before)
  })

  it('null всегда в конце, даже за отрицательными значениями', () => {
    // null в JavaScript коирует в 0 при арифметике. Без явной обработки
    // null - 0 = 0 (ничья), а null - (-10) = 10 (положительное), что
    // отправило бы «нет данных» ВВЕРХ вместо рилса, теряющего просмотры.
    // Проект требует «нет данных = —, не 0» — эта ветка обязательна.
    const testRows = [
      row({ id: 'rising', growth7d: 50, postedAt: ago(1), createdAt: ago(1) }),
      row({ id: 'noData', growth7d: null, postedAt: ago(1), createdAt: ago(2) }),
      row({ id: 'declining', growth7d: -10, postedAt: ago(1), createdAt: ago(3) }),
    ]

    expect(applyFeed(testRows, state({ sort: 'growth' }), NOW).map((r) => r.id)).toEqual([
      'rising',
      'declining',
      'noData',
    ])
  })
})
