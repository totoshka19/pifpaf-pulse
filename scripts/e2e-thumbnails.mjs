/**
 * Сквозная проверка обложек на запущенном дев-сервере.
 *
 *   npm run dev              # в одном окне
 *   npm run e2e:thumbnails   # в другом
 *
 * Работает при APIFY_MOCK=1: метрики берутся из фикстур, но обложки скачиваются
 * по-настоящему — в фикстурах лежат живые ссылки на CDN Instagram.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const BASE = process.env.E2E_BASE ?? 'http://localhost:3000'
const DIR = join(process.cwd(), 'fixtures', 'apify')

const CODES = readdirSync(DIR)
  .filter((f) => f.endsWith('.json'))
  .flatMap((f) => {
    const parsed = JSON.parse(readFileSync(join(DIR, f), 'utf8'))
    return Array.isArray(parsed) ? parsed : [parsed]
  })
  .map((item) => item.shortCode)

const reelUrl = (code) => `https://www.instagram.com/reel/${code}/`

let failed = 0
const check = (label, condition, detail = '') => {
  console.log(`  ${condition ? '✅' : '❌'} ${label}${detail ? ': ' + detail : ''}`)
  if (!condition) failed++
}

/** Отдельная «сессия» со своими куками. */
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
  call.raw = (path) => fetch(`${BASE}${path}`, { headers: cookie ? { cookie } : {} })
  return call
}

const stamp = Date.now()
const owner = session()
const stranger = session()
const guest = session()

console.log('\n── Подготовка')
await owner('POST', '/api/auth/register', {
  email: `cover.owner.${stamp}@example.invalid`,
  password: 'парольДляТеста',
  displayName: 'Владелец',
})
await stranger('POST', '/api/auth/register', {
  email: `cover.stranger.${stamp}@example.invalid`,
  password: 'парольДляТеста',
  displayName: 'Посторонний',
})

const added = await owner('POST', '/api/reels', { url: reelUrl(CODES[0]) })
check('рилс добавлен', added.status === 202)

const card = await owner('GET', `/api/reels/${added.json.id}`)
check('данные подтянулись', card.json?.reel?.syncStatus === 'ok', card.json?.reel?.syncStatus)
const reelId = added.json.id

console.log('\n── Отдача обложки')
const image = await owner.raw(`/api/thumbnails/${reelId}`)
check('HTTP 200', image.status === 200, String(image.status))
check('тип image/webp', image.headers.get('content-type') === 'image/webp', image.headers.get('content-type'))

const cacheControl = image.headers.get('cache-control') ?? ''
check('кеш иммутабельный', cacheControl.includes('immutable'), cacheControl)
check('кеш приватный, не общий', cacheControl.includes('private'), cacheControl)

const bytes = Buffer.from(await image.arrayBuffer())
check('это настоящий WebP по сигнатуре', bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP')
check(
  'вес в диапазоне замеров 43–70 КБ',
  bytes.length > 20_000 && bytes.length < 120_000,
  `${(bytes.length / 1024).toFixed(0)} КБ вместо ~330 КБ оригинала`,
)

console.log('\n── Доступ')
check('гостю — 401', (await guest.raw(`/api/thumbnails/${reelId}`)).status === 401)
check('чужому — 404', (await stranger.raw(`/api/thumbnails/${reelId}`)).status === 404)
check(
  'несуществующий рилс — тот же 404',
  (await owner.raw('/api/thumbnails/00000000-0000-0000-0000-000000000000')).status === 404,
)

console.log('\n── Идемпотентность')
const second = await owner('GET', `/api/reels/${reelId}`)
check('повторный заход не ломает карточку', second.json?.reel?.syncStatus === 'ok')
const again = await owner.raw(`/api/thumbnails/${reelId}`)
const againBytes = Buffer.from(await again.arrayBuffer())
check('обложка та же байт в байт', againBytes.equals(bytes))

console.log('\n── Удаление уносит обложку')
await owner('DELETE', `/api/reels/${reelId}`)
check('обложка удалённого рилса — 404', (await owner.raw(`/api/thumbnails/${reelId}`)).status === 404)

console.log(failed ? `\n❌ Провалов: ${failed}\n` : '\n✅ Обложки работают\n')
process.exit(failed ? 1 : 0)
