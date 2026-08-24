/**
 * Сквозная проверка ленты на запущенном дев-сервере.
 *
 *   npm run dev       # в одном окне
 *   npm run e2e:feed  # в другом
 *
 * Проверяется то, что юнит-тесты увидеть не могут: реальные коды ответов,
 * изоляция между кабинетами и поведение троттлинга. Тексты сверяются здесь,
 * а не в curl: консоль Windows портит кириллицу и даёт ложный результат.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const BASE = process.env.E2E_BASE ?? 'http://localhost:3000'
const DIR = join(process.cwd(), 'fixtures', 'apify')

const CODES = readdirSync(DIR)
  .filter((file) => file.endsWith('.json'))
  .flatMap((file) => {
    const parsed = JSON.parse(readFileSync(join(DIR, file), 'utf8'))
    return Array.isArray(parsed) ? parsed : [parsed]
  })
  .map((item) => item.shortCode)

const reelUrl = (code) => `https://www.instagram.com/reel/${code}/`

let failed = 0
const check = (label, condition, detail = '') => {
  console.log(`  ${condition ? '✅' : '❌'} ${label}${detail ? ': ' + detail : ''}`)
  if (!condition) failed++
}

function session() {
  let cookie = ''
  const call = async (method, path, body) => {
    const response = await fetch(`${BASE}${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const setCookie = response.headers.get('set-cookie')
    if (setCookie) cookie = setCookie.split(';')[0]
    const text = await response.text()
    try {
      return { status: response.status, json: JSON.parse(text) }
    } catch {
      return { status: response.status, json: text }
    }
  }
  return call
}

const stamp = Date.now()
const owner = session()
const stranger = session()
const guest = session()

console.log('\n── Подготовка')
await owner('POST', '/api/auth/register', {
  email: `feed-owner-${stamp}@example.invalid`,
  password: 'парольпароль1',
  displayName: 'Владелец',
})
await stranger('POST', '/api/auth/register', {
  email: `feed-stranger-${stamp}@example.invalid`,
  password: 'парольпароль1',
  displayName: 'Чужой',
})

const added = await owner('POST', '/api/reels', { url: reelUrl(CODES[0]) })
check('рилс принят', added.status === 202, String(added.status))
const id = added.json.id

/**
 * ЕДИНСТВЕННАЯ проверка во всём срезе, которая ловит регрессию троттлинга.
 *
 * Прямо сейчас рилс в промежуточном состоянии: `sync_runs` строку уже получил
 * (её пишет POST /api/reels), а `reels.last_synced_at` ещё пуст — приём данных
 * не состоялся. Ровно здесь две версии кода расходятся:
 *
 *   троттлинг по `sync_runs.started_at`  → 429  (верно)
 *   троттлинг по `reels.last_synced_at`  → 202  (баг, найден в срезе 5)
 *
 * Юнит-тест этого не поймает: чистая `checkManualSync` никогда не была
 * сломана, ошибка жила в том, КАКОЕ значение маршрут в неё передаёт,
 * а покрытия у маршрутов в репозитории нет.
 */
console.log('\n── Троттлинг до первого успешного приёма')
const earlySync = await owner('POST', `/api/reels/${id}/sync`)
check(
  'рилс без last_synced_at, но со свежим прогоном — уже троттлится',
  earlySync.status === 429,
  `${earlySync.status} (202 значит, что троттлинг снова смотрит на last_synced_at)`,
)

console.log('\n── Ожидание данных')
let reel = null
for (let attempt = 0; attempt < 30; attempt++) {
  const card = await owner('GET', `/api/reels/${id}`)
  reel = card.json.reel
  if (reel?.syncStatus !== 'pending') break
  await new Promise((resolve) => setTimeout(resolve, 1000))
}
check('рилс вышел из pending', reel?.syncStatus === 'ok', reel?.syncStatus)

console.log('\n── Лента')
const feed = await owner('GET', '/api/reels')
const row = feed.json.reels.find((item) => item.id === id)
check('рилс есть в ленте', Boolean(row))
// Опциональная цепочка ниже НЕ декоративная: если рилса в ленте нет — именно
// то, что проверяет чек выше, — прямое обращение к row.views бросило бы
// TypeError и оборвало скрипт до сортировок, дедупа, изоляции и удаления,
// потеряв диагностику ровно тогда, когда она нужнее всего.
check('просмотры пришли числом', typeof row?.views === 'number', typeof row?.views)
check('growth7d присутствует в ответе', Boolean(row) && 'growth7d' in row)
check(
  'growth7d равен null при одной точке',
  row?.growth7d === null,
  String(row?.growth7d),
)

console.log('\n── Сортировки')
for (const sort of ['added', 'date', 'views', 'growth']) {
  const sorted = await owner('GET', `/api/reels?sort=${sort}`)
  check(`sort=${sort} отвечает 200`, sorted.status === 200, String(sorted.status))
}
const injected = await owner('GET', '/api/reels?sort=views;DROP TABLE reels')
check('мусор в sort не ломает запрос', injected.status === 200, String(injected.status))

console.log('\n── Дедуп')
const again = await owner('POST', '/api/reels', { url: reelUrl(CODES[0]) })
check('повтор даёт 409', again.status === 409, String(again.status))
check('в ответе есть id существующего', again.json.id === id)
check('текст по-русски и без кода', /уже добавлен/i.test(again.json.error ?? ''))

console.log('\n── Ручное обновление')
const sync = await owner('POST', `/api/reels/${id}/sync`)
check(
  'сразу после синхронизации — отказ по троттлингу',
  sync.status === 429,
  String(sync.status),
)
check(
  'в отказе сказано, сколько ждать',
  /загляни через \d+ минут/i.test(sync.json.error ?? ''),
  sync.json.error,
)
check('в тексте нет кода ошибки', !/\b\d{3}\b/.test(sync.json.error ?? ''))

console.log('\n── Изоляция')
const alienSync = await stranger('POST', `/api/reels/${id}/sync`)
check('чужому — 404, а не 403', alienSync.status === 404, String(alienSync.status))
const guestSync = await guest('POST', `/api/reels/${id}/sync`)
check('гостю — 401', guestSync.status === 401, String(guestSync.status))
const alienFeed = await stranger('GET', '/api/reels')
check('чужой рилс не виден в чужой ленте', alienFeed.json.reels.length === 0)

console.log('\n── Удаление')
const removed = await owner('DELETE', `/api/reels/${id}`)
check('рилс удалён', removed.status === 200, String(removed.status))
const afterDelete = await owner('GET', `/api/reels/${id}`)
check('после удаления — 404', afterDelete.status === 404, String(afterDelete.status))

console.log(failed === 0 ? '\n✅ Все проверки прошли\n' : `\n❌ Провалено: ${failed}\n`)
process.exit(failed === 0 ? 0 : 1)
