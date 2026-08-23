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
 * Как наполнить: прогнать apify/instagram-scraper в консоли Apify на 3–5 реальных
 * ссылках, скачать датасет в JSON и положить файлы в fixtures/apify/.
 * Кредиты при этом тратятся один раз, а не на каждом прогоне тестов.
 */

const FIXTURES_DIR = join(process.cwd(), 'fixtures', 'apify')

const files = existsSync(FIXTURES_DIR)
  ? readdirSync(FIXTURES_DIR).filter((name) => name.endsWith('.json'))
  : []

describe.runIf(files.length > 0)('нормализация на реальных выгрузках Apify', () => {
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
      expect(result!.views).not.toBeUndefined()
    }
  })
})

describe.runIf(files.length === 0)('фикстуры Apify', () => {
  it.skip('не найдены в fixtures/apify — тест на реальных данных не выполнялся', () => {})
})
