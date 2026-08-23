/**
 * Сквозная проверка приёма рилсов на запущенном дев-сервере.
 *
 *   npm run dev            # в одном окне
 *   npm run e2e:reels      # в другом
 *
 * Клиент на Node, а не curl: в Windows-консоли кириллица в теле запроса
 * портится, и можно получить как ложную ошибку, так и ложный успех.
 * Проверено в срезе 1.
 *
 * Работает при APIFY_MOCK=1 — кредиты не тратятся.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const BASE = process.env.E2E_BASE ?? 'http://localhost:3000'

/** Берём shortcode из фикстур: мок отдаёт данные только по ним. */
function fixtureShortcodes() {
  const dir = join(process.cwd(), 'fixtures', 'apify')
  if (!existsSync(dir)) throw new Error('Нет fixtures/apify')

  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .flatMap((f) => {
      const parsed = JSON.parse(readFileSync(join(dir, f), 'utf8'))
      return Array.isArray(parsed) ? parsed : [parsed]
    })
    .map((item) => item.shortCode)
}

const CODES = fixtureShortcodes()
const reelUrl = (code) => `https://www.instagram.com/reel/${code}/`

let failed = 0
function check(label, actual, expected) {
  const good = JSON.stringify(actual) === JSON.stringify(expected)
  console.log(`  ${good ? '✅' : '❌'} ${label}: ${JSON.stringify(actual)}${good ? '' : ` (ждали ${JSON.stringify(expected)})`}`)
  if (!good) failed++
}

/** Отдельная «сессия»: свой набор кук. */
function session() {
  let cookie = ''
  return async (method, path, body) => {
    const response = await fetch(`${BASE}${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const setCookie = response.headers.get('set-cookie')
    if (setCookie) cookie = setCookie.split(';')[0]
    const text = await response.text()
    let json
    try {
      json = JSON.parse(text)
    } catch {
      json = text
    }
    return { status: response.status, json }
  }
}

const stamp = Date.now()
const alice = session()
const bob = session()

console.log('\n── Регистрация двух блогеров')
const a = await alice('POST', '/api/auth/register', {
  email: `e2e.alice.${stamp}@example.invalid`,
  password: 'парольДляТеста',
  displayName: 'Алиса',
})
check('Алиса зарегистрирована', a.status, 201)

const b = await bob('POST', '/api/auth/register', {
  email: `e2e.bob.${stamp}@example.invalid`,
  password: 'парольДляТеста',
  displayName: 'Борис',
})
check('Борис зарегистрирован', b.status, 201)

console.log('\n── Приём ссылки')
const added = await alice('POST', '/api/reels', { url: reelUrl(CODES[0]) })
check('вставка ссылки → 202', added.status, 202)
check('статус pending', added.json.syncStatus, 'pending')
const reelId = added.json.id

console.log('\n── Отказы при вставке')
check('дубль → 409', (await alice('POST', '/api/reels', { url: reelUrl(CODES[0]) })).status, 409)
check('чужой домен → 400', (await alice('POST', '/api/reels', { url: 'https://tiktok.com/x' })).status, 400)
check('пустая строка → 400', (await alice('POST', '/api/reels', { url: '' })).status, 400)
check('без сессии → 401', (await session()('POST', '/api/reels', { url: reelUrl(CODES[0]) })).status, 401)

console.log('\n── Продвижение статуса через карточку')
const card = await alice('GET', `/api/reels/${reelId}`)
check('карточка отдаётся', card.status, 200)
check('статус стал ok', card.json.reel.syncStatus, 'ok')
check('снапшот записан', card.json.snapshots.length, 1)
console.log(
  `     автор @${card.json.reel.ownerUsername}, просмотров ${card.json.snapshots[0].views}, ` +
    `опубликован ${card.json.reel.postedAt?.slice(0, 10)}`,
)
check('назначен следующий опрос', typeof card.json.reel.nextSyncAt, 'string')

console.log('\n── Повторный запрос карточки не плодит снапшоты')
const again = await alice('GET', `/api/reels/${reelId}`)
check('снапшот по-прежнему один', again.json.snapshots.length, 1)

console.log('\n── Лента')
await alice('POST', '/api/reels', { url: reelUrl(CODES[1]) })
await alice('GET', `/api/reels/${(await alice('GET', '/api/reels')).json.reels[0].id}`)
const list = await alice('GET', '/api/reels')
check('в ленте два рилса', list.json.reels.length, 2)
check('сортировка по просмотрам не падает', (await alice('GET', '/api/reels?sort=views')).status, 200)
check('мусор в sort не ломает запрос', (await alice('GET', '/api/reels?sort=DROP TABLE')).status, 200)

console.log('\n── Изоляция данных')
check('чужая карточка → 404', (await bob('GET', `/api/reels/${reelId}`)).status, 404)
check('несуществующая → тот же 404', (await bob('GET', '/api/reels/00000000-0000-0000-0000-000000000000')).status, 404)
check('лента Бориса пуста', (await bob('GET', '/api/reels')).json.reels.length, 0)
check('удалить чужой → 404', (await bob('DELETE', `/api/reels/${reelId}`)).status, 404)

console.log('\n── Удаление')
check('свой рилс удаляется', (await alice('DELETE', `/api/reels/${reelId}`)).status, 200)
check('в ленте остался один', (await alice('GET', '/api/reels')).json.reels.length, 1)
check('удалённый больше не отдаётся', (await alice('GET', `/api/reels/${reelId}`)).status, 404)

console.log(failed ? `\n❌ Провалов: ${failed}\n` : '\n✅ Все проверки пройдены\n')
process.exit(failed ? 1 : 0)
