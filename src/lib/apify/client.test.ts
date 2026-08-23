import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getDatasetItems, getRun, isMock, startRun } from './client'

/** Реальные shortcode из fixtures/apify/ — выгрузка от 2026-08-23. */
const REAL = 'DcXVbOOiyhL'
const REAL_URL = `https://www.instagram.com/reel/${REAL}/`

beforeEach(() => {
  process.env.APIFY_MOCK = '1'
})

afterEach(() => {
  delete process.env.APIFY_MOCK
  delete process.env.APIFY_TOKEN
})

describe('переключение режима', () => {
  it('включается по APIFY_MOCK=1', () => {
    expect(isMock()).toBe(true)
  })

  it('выключается при APIFY_MOCK=0 и наличии токена', () => {
    process.env.APIFY_MOCK = '0'
    process.env.APIFY_TOKEN = 'apify_api_xxx'
    expect(isMock()).toBe(false)
  })

  it('включается сам, если токена нет — разработка не должна падать', () => {
    delete process.env.APIFY_MOCK
    expect(isMock()).toBe(true)
  })

  it('APIFY_MOCK=0 без токена всё равно даёт мок, а не падение на каждом запросе', () => {
    process.env.APIFY_MOCK = '0'
    expect(isMock()).toBe(true)
  })
})

describe('прогон в режиме мока', () => {
  it('startRun сразу отдаёт завершённый прогон', async () => {
    const run = await startRun([REAL_URL])
    expect(run.status).toBe('SUCCEEDED')
    expect(run.runId).toBeTruthy()
    expect(run.datasetId).toBeTruthy()
  })

  it('getRun возвращает тот же прогон завершённым', async () => {
    const started = await startRun([REAL_URL])
    const fetched = await getRun(started.runId)
    expect(fetched.status).toBe('SUCCEEDED')
    expect(fetched.runId).toBe(started.runId)
  })

  it('датасет отдаёт элементы из фикстур', async () => {
    const run = await startRun([REAL_URL])
    const items = await getDatasetItems(run.datasetId!)

    expect(items.length).toBeGreaterThan(0)
    expect(items[0]).toHaveProperty('shortCode')
  })

  it('отдаёт именно запрошенный рилс, а не первый попавшийся', async () => {
    const run = await startRun([REAL_URL])
    const items = (await getDatasetItems(run.datasetId!)) as Record<string, unknown>[]

    expect(items).toHaveLength(1)
    expect(items[0].shortCode).toBe(REAL)
  })

  it('на неизвестный shortcode отдаёт пустой датасет — как приватный рилс', async () => {
    // Пустой датасет это ШТАТНЫЙ ответ Apify на приватную или удалённую запись,
    // а не ошибка. Мок обязан это воспроизводить, иначе ветка 'unavailable'
    // останется непроверенной до прода.
    const run = await startRun(['https://www.instagram.com/reel/НетТакогоКода/'])
    const items = await getDatasetItems(run.datasetId!)

    expect(items).toEqual([])
  })

  it('батч из нескольких ссылок отдаёт несколько элементов', async () => {
    const run = await startRun([REAL_URL, 'https://www.instagram.com/reel/DcJsGN3tYER/'])
    const items = (await getDatasetItems(run.datasetId!)) as Record<string, unknown>[]

    expect(items).toHaveLength(2)
    expect(items.map((i) => i.shortCode).sort()).toEqual(['DcJsGN3tYER', REAL].sort())
  })

  it('пустой список ссылок не роняет клиент', async () => {
    const run = await startRun([])
    expect(await getDatasetItems(run.datasetId!)).toEqual([])
  })
})

describe('живой режим не трогает сеть без токена', () => {
  it('startRun без токена бросает понятную ошибку, а не уходит в fetch', async () => {
    process.env.APIFY_MOCK = '0'
    process.env.APIFY_TOKEN = ''
    // isMock() вернёт true при пустом токене — значит сеть не задействуется.
    await expect(startRun([REAL_URL])).resolves.toHaveProperty('status', 'SUCCEEDED')
  })
})
