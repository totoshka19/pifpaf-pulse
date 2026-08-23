import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Клиент Apify с двумя режимами.
 *
 * Мок читает fixtures/apify/*.json и подбирает элементы по shortcode из ссылки.
 * Живой режим работает СТРОГО АСИНХРОННО: запускает прогон и сразу возвращает
 * runId, не дожидаясь результата.
 *
 * Синхронный `run-sync-get-dataset-items` не применим в принципе: Netlify free
 * обрывает функцию через 10 секунд, background-функции доступны только на Pro,
 * а прогон актора идёт 30–60 секунд (PLAN.md §1). Состояние двигают короткие
 * последующие запросы — см. `GET /api/reels/:id`.
 */

export type RunStatus = 'RUNNING' | 'SUCCEEDED' | 'FAILED'
export type RunHandle = {
  runId: string
  datasetId: string | null
  status: RunStatus
}

const API = 'https://api.apify.com/v2'

/** Префикс отличает поддельный идентификатор прогона от настоящего. */
const MOCK_PREFIX = 'mock:'

export function isMock(): boolean {
  if (process.env.APIFY_MOCK === '1') return true

  // Даже при APIFY_MOCK=0: без токена живой режим не заработает, а падать
  // на каждом запросе хуже, чем честно отдавать фикстуры.
  return !process.env.APIFY_TOKEN
}

function actorId(): string {
  return process.env.APIFY_ACTOR_ID ?? 'apify~instagram-scraper'
}

function token(): string {
  const value = process.env.APIFY_TOKEN
  if (!value) throw new Error('APIFY_TOKEN не задан')
  return value
}

/** Все элементы из всех файлов fixtures/apify/. */
function fixtureItems(): Record<string, unknown>[] {
  const dir = join(process.cwd(), 'fixtures', 'apify')
  if (!existsSync(dir)) return []

  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .flatMap((name) => {
      const parsed: unknown = JSON.parse(readFileSync(join(dir, name), 'utf8'))
      return Array.isArray(parsed) ? parsed : [parsed]
    })
}

/**
 * Мок не может хранить состояние между вызовами (serverless, разные процессы),
 * поэтому запрошенные shortcode кодируются прямо в идентификатор прогона.
 */
function shortcodesFrom(urls: string[]): string[] {
  return urls.map((url) => url.split('?')[0].split('/').filter(Boolean).pop() ?? '')
}

export async function startRun(urls: string[]): Promise<RunHandle> {
  if (isMock()) {
    const id = MOCK_PREFIX + shortcodesFrom(urls).join(',')
    return { runId: id, datasetId: id, status: 'SUCCEEDED' }
  }

  const response = await fetch(`${API}/acts/${actorId()}/runs?token=${token()}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      resultsType: 'posts',
      directUrls: urls,
      // Ссылка на профиль вместо рилса заставила бы актор грести всю ленту.
      // Единица закрывает этот сценарий независимо от того, что пришло на вход.
      resultsLimit: 1,
    }),
  })

  if (!response.ok) {
    throw new Error(`Apify не принял запуск: ${response.status}`)
  }

  const { data } = await response.json()
  return {
    runId: data.id,
    datasetId: data.defaultDatasetId ?? null,
    status: data.status,
  }
}

export async function getRun(runId: string): Promise<RunHandle> {
  if (runId.startsWith(MOCK_PREFIX)) {
    return { runId, datasetId: runId, status: 'SUCCEEDED' }
  }

  const response = await fetch(`${API}/actor-runs/${runId}?token=${token()}`)
  if (!response.ok) {
    throw new Error(`Apify не отдал статус прогона: ${response.status}`)
  }

  const { data } = await response.json()
  return {
    runId: data.id,
    datasetId: data.defaultDatasetId ?? null,
    status: data.status,
  }
}

export async function getDatasetItems(datasetId: string): Promise<unknown[]> {
  if (datasetId.startsWith(MOCK_PREFIX)) {
    const wanted = new Set(
      datasetId.slice(MOCK_PREFIX.length).split(',').filter(Boolean),
    )
    return fixtureItems().filter((item) => wanted.has(String(item.shortCode)))
  }

  const response = await fetch(`${API}/datasets/${datasetId}/items?token=${token()}`)
  if (!response.ok) {
    throw new Error(`Apify не отдал датасет: ${response.status}`)
  }

  return response.json()
}
