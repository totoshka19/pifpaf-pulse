import { describe, expect, it } from 'vitest'
import { normalizeApifyItem } from './normalize-item'

/** Форма элемента датасета apify/instagram-scraper для рилса. */
const base = {
  shortCode: 'C8xYzAbCdEf',
  caption: 'Тест',
  ownerUsername: 'pifpaf.ai',
  timestamp: '2026-08-01T12:00:00.000Z',
  videoDuration: 31.5,
  displayUrl: 'https://scontent.cdninstagram.com/x.jpg',
  productType: 'clips',
  likesCount: 100,
  commentsCount: 5,
  videoPlayCount: 5000,
  videoViewCount: 4200,
}

describe('normalizeApifyItem — приоритет метрик просмотров', () => {
  it('берёт videoPlayCount, когда есть оба поля', () => {
    expect(normalizeApifyItem(base)?.views).toBe(5000)
  })

  it('падает на videoViewCount, когда playCount равен null', () => {
    expect(normalizeApifyItem({ ...base, videoPlayCount: null })?.views).toBe(4200)
  })

  it('отдаёт null, когда обе метрики отсутствуют', () => {
    const result = normalizeApifyItem({
      ...base,
      videoPlayCount: null,
      videoViewCount: null,
    })
    expect(result?.views).toBeNull()
  })

  it('сохраняет plays отдельно от views', () => {
    const result = normalizeApifyItem(base)
    expect(result?.plays).toBe(5000)
    expect(result?.views).toBe(5000)
  })
})

describe('normalizeApifyItem — скрытые и битые счётчики', () => {
  it('превращает -1 (лайки скрыты автором) в null, а не в минус один', () => {
    expect(normalizeApifyItem({ ...base, likesCount: -1 })?.likes).toBeNull()
  })

  it('не путает ноль со скрытым значением', () => {
    expect(normalizeApifyItem({ ...base, commentsCount: 0 })?.comments).toBe(0)
  })

  it('отбрасывает нечисловой счётчик', () => {
    expect(normalizeApifyItem({ ...base, likesCount: 'много' })?.likes).toBeNull()
  })
})

describe('normalizeApifyItem — разбор полей', () => {
  it('разбирает дату публикации', () => {
    expect(normalizeApifyItem(base)?.postedAt?.toISOString()).toBe(
      '2026-08-01T12:00:00.000Z',
    )
  })

  it('отдаёт null на нечитаемой дате', () => {
    expect(normalizeApifyItem({ ...base, timestamp: 'вчера' })?.postedAt).toBeNull()
  })

  it('помечает не-рилс', () => {
    expect(normalizeApifyItem({ ...base, productType: 'feed' })?.isReel).toBe(false)
  })

  it('пустую подпись считает отсутствующей', () => {
    expect(normalizeApifyItem({ ...base, caption: '   ' })?.caption).toBeNull()
  })

  it('возвращает null, если нет shortCode', () => {
    expect(normalizeApifyItem({ ...base, shortCode: undefined })).toBeNull()
  })

  it('переживает пустой объект', () => {
    expect(normalizeApifyItem({})).toBeNull()
  })

  it('переживает null и строку вместо объекта', () => {
    expect(normalizeApifyItem(null)).toBeNull()
    expect(normalizeApifyItem('не объект')).toBeNull()
  })
})
