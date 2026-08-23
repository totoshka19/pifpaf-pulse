import { describe, expect, it } from 'vitest'
import { reviveRow } from './parse'

describe('reviveRow — оживление дат из JSON', () => {
  const raw = {
    id: 'reel-1',
    shortcode: 'Cxxxxxx',
    url: 'https://www.instagram.com/reel/Cxxxxxx/',
    caption: 'Подпись',
    ownerUsername: 'pifpafai',
    thumbnailSrc: null,
    postedAt: '2026-08-21T16:30:00.000Z',
    syncStatus: 'ok',
    syncError: null,
    lastSyncedAt: '2026-08-24T16:00:00.000Z',
    views: 1000,
    likes: 10,
    comments: 1,
    capturedAt: '2026-08-24T16:00:00.000Z',
    createdAt: '2026-08-21T17:00:00.000Z',
    growth7d: 50,
  }

  it('строки дат становятся объектами Date', () => {
    const row = reviveRow(raw)

    // Без этого row.postedAt.getTime() упадёт после первого обновления ленты:
    // из RSC приходят Date, из fetch — строки.
    expect(row.postedAt).toBeInstanceOf(Date)
    expect(row.postedAt!.toISOString()).toBe('2026-08-21T16:30:00.000Z')
    expect(row.createdAt).toBeInstanceOf(Date)
    expect(row.capturedAt).toBeInstanceOf(Date)
    expect(row.lastSyncedAt).toBeInstanceOf(Date)
  })

  it('уже готовые Date проходят насквозь', () => {
    const date = new Date('2026-08-21T16:30:00.000Z')
    const row = reviveRow({ ...raw, postedAt: date })

    expect(row.postedAt).toBeInstanceOf(Date)
    expect(row.postedAt!.getTime()).toBe(date.getTime())
  })

  it('null остаётся null, а не превращается в 1970 год', () => {
    const row = reviveRow({ ...raw, postedAt: null, lastSyncedAt: null, capturedAt: null })

    expect(row.postedAt).toBeNull()
    expect(row.lastSyncedAt).toBeNull()
    expect(row.capturedAt).toBeNull()
  })

  it('мусор вместо даты не создаёт Invalid Date', () => {
    const row = reviveRow({ ...raw, postedAt: 'вчера примерно' })

    expect(row.postedAt).toBeNull()
  })

  it('createdAt обязателен: без него сортировка по добавлению сломается', () => {
    expect(() => reviveRow({ ...raw, createdAt: null })).toThrow()
  })
})
