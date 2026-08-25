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

/**
 * Зарезервированные шорткоды мока — единственный способ интеграционных
 * тестов вызвать четыре ветки обработки отказов Apify (startRun бросает,
 * getRun бросает, прогон FAILED, прогон без datasetId) без обращения к
 * живому Apify и без первого `vi.mock` в интеграционном наборе проекта.
 *
 * Живут именно здесь, а не в тестовом хелпере: этот модуль и так
 * единственное место, где решается, что вернёт Apify в мок-режиме —
 * тестовый хелпер такого решения не принимает, только просит. Действуют
 * ТОЛЬКО внутри веток `isMock()`; боевой путь (реальный `fetch` к
 * `api.apify.com`) их не видит и не проверяет вообще.
 *
 * Формат — двойное подчёркивание с обеих сторон. Настоящие шорткоды
 * Instagram — строки 5–20 символов из base64url-алфавита (A–Za–z0–9_-),
 * и хотя технически `_` в этот алфавит входит, шорткод вида
 * `__mock_throw_start__` как случайное совпадение практически не
 * встречается — маркер очевидно тестовый на вид.
 *
 * `MOCK_RUN_FAILED` намеренно с НЕпустым `datasetId`, а `MOCK_NO_DATASET`
 * намеренно со статусом `SUCCEEDED`: в `collectFinishedRuns`
 * (src/lib/sync/run-cron.ts) обе причины проверяются одним условием
 * `handle.status === 'FAILED' || !handle.datasetId` — если бы оба
 * маркера били сразу по обеим причинам, мутация одной половины условия
 * осталась бы незамеченной тестом на другую половину.
 */
// Экспортированы, чтобы интеграционные тесты не дублировали литералы —
// единственный источник правды об их написании остаётся здесь.
export const MOCK_THROW_START = '__mock_throw_start__'
export const MOCK_THROW_GETRUN = '__mock_throw_getrun__'
export const MOCK_RUN_FAILED = '__mock_run_failed__'
export const MOCK_NO_DATASET = '__mock_no_dataset__'

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
    const codes = shortcodesFrom(urls)

    // Маркер отказа запуска — см. доккомент у объявлений выше.
    if (codes.includes(MOCK_THROW_START)) {
      throw new Error(`mock: startRun настроен на отказ маркером ${MOCK_THROW_START}`)
    }

    const id = MOCK_PREFIX + codes.join(',')
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
    const codes = runId.slice(MOCK_PREFIX.length).split(',')

    // Три маркера отказа — см. доккомент у объявлений выше. Проверка ДО
    // штатного возврата, поведение вне маркеров ниже не меняется ни на строку.
    if (codes.includes(MOCK_THROW_GETRUN)) {
      throw new Error(`mock: getRun настроен на отказ маркером ${MOCK_THROW_GETRUN}`)
    }
    if (codes.includes(MOCK_RUN_FAILED)) {
      return { runId, datasetId: runId, status: 'FAILED' }
    }
    if (codes.includes(MOCK_NO_DATASET)) {
      return { runId, datasetId: null, status: 'SUCCEEDED' }
    }

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
