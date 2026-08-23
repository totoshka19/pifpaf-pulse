import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { normalizeApifyItem } from './normalize-item'

/**
 * Сверка нормализации с настоящими ответами актора.
 *
 * Юнит-тесты рядом проверяют логику на выдуманном объекте — они пройдут даже
 * если актор переименует половину полей. Этот тест ловит именно расхождение
 * ожидаемой схемы с фактической, поэтому работает на живых выгрузках.
 *
 * Как наполнить: PLAN.md §6 и fixtures/apify/README.md.
 * Кредиты Apify тратятся один раз при выгрузке, а не на каждом прогоне тестов.
 */

const FIXTURES_DIR = join(process.cwd(), 'fixtures', 'apify')

const files = existsSync(FIXTURES_DIR)
  ? readdirSync(FIXTURES_DIR).filter((name) => name.endsWith('.json'))
  : []

describe('нормализация на реальных выгрузках Apify', () => {
  if (files.length === 0) {
    it.skip('фикстур нет — положи выгрузку в fixtures/apify/, см. README', () => {})
    return
  }

  it.each(files)('%s разбирается без потерь', (file) => {
    const parsed: unknown = JSON.parse(readFileSync(join(FIXTURES_DIR, file), 'utf8'))
    const items = Array.isArray(parsed) ? parsed : [parsed]

    expect(items.length).toBeGreaterThan(0)

    for (const item of items) {
      const result = normalizeApifyItem(item)

      // Схема разошлась с ожидаемой — скорее всего переименовали shortCode.
      expect(result).not.toBeNull()
      expect(result!.shortcode).toMatch(/^[A-Za-z0-9_-]{5,20}$/)

      // Три поля названы в ТЗ и обязаны приходить: просмотры, дата, обложка.
      expect(result!.postedAt).toBeInstanceOf(Date)
      expect(result!.thumbnailSrc).toBeTruthy()
      expect(typeof result!.views === 'number' || result!.views === null).toBe(true)

      // Отрицательных счётчиков быть не должно: -1 (скрыто) обязан стать null,
      // иначе CHECK-ограничение в базе отвергнет вставку снапшота.
      for (const count of [result!.views, result!.plays, result!.likes, result!.comments]) {
        if (count !== null) expect(count).toBeGreaterThanOrEqual(0)
      }

      // productType 'clips' — единственный признак, отличающий рилс от фото.
      const raw = item as Record<string, unknown>
      expect(result!.isReel).toBe(raw.productType === 'clips')
    }
  })

  it('в выгрузке есть хотя бы один рилс, а не только фото', () => {
    const reels = files
      .flatMap((file) => JSON.parse(readFileSync(join(FIXTURES_DIR, file), 'utf8')))
      .map(normalizeApifyItem)
      .filter((item) => item?.isReel)

    expect(reels.length).toBeGreaterThan(0)
  })
})
