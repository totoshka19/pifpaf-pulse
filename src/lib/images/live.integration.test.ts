import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { fetchImage } from './fetch'
import { processThumbnail } from './process'

/**
 * Сквозная проверка на НАСТОЯЩЕЙ обложке Instagram: скачивание + обработка.
 *
 * Юнит-тесты рядом подменяют сеть и генерируют картинки — они пройдут даже если
 * CDN начнёт отдавать HTML или sharp разучится читать JPEG от Instagram.
 * Здесь проверяется связка целиком, поэтому тест интеграционный.
 */
const DIR = join(process.cwd(), 'fixtures', 'apify')

const items = readdirSync(DIR)
  .filter((f) => f.endsWith('.json'))
  .flatMap((f) => {
    const parsed = JSON.parse(readFileSync(join(DIR, f), 'utf8'))
    return Array.isArray(parsed) ? parsed : [parsed]
  })

describe('скачивание и обработка настоящих обложек Instagram', () => {
  it.each(items.map((i) => [String(i.shortCode), String(i.displayUrl)]))(
    '%s скачивается и ужимается',
    async (_code, url) => {
      const raw = await fetchImage(url)

      // Ссылки живут ~4,5 суток. Если тест упал здесь — фикстуры протухли,
      // нужна новая выгрузка, а не правка кода.
      expect(raw, 'ссылка в фикстуре протухла — нужна свежая выгрузка').not.toBeNull()

      const image = await processThumbnail(raw!)
      expect(image).not.toBeNull()
      expect(image!.mime).toBe('image/webp')
      expect(image!.width).toBeLessThanOrEqual(480)
      expect(image!.bytes).toBeLessThan(raw!.length)
    },
    30_000,
  )
})
