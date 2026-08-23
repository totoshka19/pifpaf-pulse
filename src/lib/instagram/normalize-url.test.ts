import { describe, expect, it } from 'vitest'
import { normalizeReelUrl } from './normalize-url'

const CODE = 'C8xYzAbCdEf'
const CANONICAL = `https://www.instagram.com/reel/${CODE}/`

describe('normalizeReelUrl — принимает реальные формы ссылок', () => {
  const accepted: [string, string][] = [
    ['каноническая', `https://www.instagram.com/reel/${CODE}/`],
    ['множественное число', `https://www.instagram.com/reels/${CODE}/`],
    ['пост', `https://instagram.com/p/${CODE}/`],
    ['igtv', `https://www.instagram.com/tv/${CODE}/`],
    ['с автором в пути', `https://www.instagram.com/pifpaf.ai/reel/${CODE}/`],
    [
      'хвост от «поделиться»',
      `https://www.instagram.com/reel/${CODE}/?igsh=MzRlODBiNWFlZA%3D%3D&img_index=1`,
    ],
    ['без протокола', `instagram.com/reel/${CODE}`],
    ['мобильный поддомен', `https://m.instagram.com/reel/${CODE}/`],
    ['без слеша на конце', `https://www.instagram.com/reel/${CODE}`],
    ['с мусором по краям', `  https://www.instagram.com/reel/${CODE}/\n`],
  ]

  it.each(accepted)('%s', (_name, input) => {
    expect(normalizeReelUrl(input)).toEqual({
      ok: true,
      shortcode: CODE,
      canonicalUrl: CANONICAL,
    })
  })
})

describe('normalizeReelUrl — отклоняет мусор с человеческим объяснением', () => {
  const rejected: [string, string][] = [
    ['пустая строка', ''],
    ['только пробелы', '   '],
    ['не ссылка', 'просто текст'],
    ['чужой домен', 'https://www.tiktok.com/@user/video/123'],
    ['похожий домен-обманка', 'https://instagram.com.evil.ru/reel/C8xYzAbCdEf/'],
    ['инстаграм, но профиль', 'https://www.instagram.com/pifpaf.ai/'],
    ['служебный раздел', 'https://www.instagram.com/explore/tags/reels/'],
    ['нет shortcode', 'https://www.instagram.com/reel/'],
    ['слишком короткий код', 'https://www.instagram.com/reel/ab/'],
  ]

  it.each(rejected)('%s', (_name, input) => {
    const result = normalizeReelUrl(input)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      // Причина должна быть готова к показу в интерфейсе:
      // непустая и без следов машинного происхождения.
      expect(result.reason.length).toBeGreaterThan(0)
      expect(result.reason).not.toMatch(/error|undefined|null/i)
    }
  })
})
