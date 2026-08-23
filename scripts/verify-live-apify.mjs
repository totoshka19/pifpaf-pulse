/**
 * Сверка с ЖИВЫМ Apify. Тратит кредиты — запускать осознанно.
 *
 *   APIFY_MOCK=0 в .env.local, дев-сервер перезапущен
 *   npm run verify:live
 *
 * Берём тот же рилс, что лежит в фикстурах: если живые метрики окажутся больше
 * снятых несколько часов назад — это подтвердит разом, что схема ответа актора
 * не изменилась, данные настоящие, и правило «снапшот только при изменении»
 * сработает на реальном росте.
 *
 * Совпадение чисел до единицы — сигнал тревожный: значит либо ответ закеширован,
 * либо мы всё ещё читаем фикстуру.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const BASE = process.env.E2E_BASE ?? 'http://localhost:3000'
const DIR = join(process.cwd(), 'fixtures', 'apify')

const fixture = (() => {
  const file = readdirSync(DIR).find((f) => f.endsWith('.json'))
  const parsed = JSON.parse(readFileSync(join(DIR, file), 'utf8'))
  return (Array.isArray(parsed) ? parsed : [parsed])[0]
})()

const SHORTCODE = String(fixture.shortCode)
const URL_ = `https://www.instagram.com/reel/${SHORTCODE}/`

let cookie = ''
async function req(method, path, body) {
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

let failed = 0
const check = (label, condition, detail = '') => {
  console.log(`  ${condition ? '✅' : '❌'} ${label}${detail ? ': ' + detail : ''}`)
  if (!condition) failed++
}

console.log(`\nСверяем рилс ${SHORTCODE} от @${fixture.ownerUsername}`)
console.log(`В фикстуре (19:05 UTC): просмотров ${fixture.videoPlayCount}, лайков ${fixture.likesCount}\n`)

await req('POST', '/api/auth/register', {
  email: `live.${Date.now()}@example.invalid`,
  password: 'парольДляСверки',
  displayName: 'Сверка',
})

console.log('── Отправляем ссылку в живой Apify')
const added = await req('POST', '/api/reels', { url: URL_ })
check('вставка принята', added.status === 202, `HTTP ${added.status}`)

if (added.status !== 202) {
  console.log('   ответ:', JSON.stringify(added.json))
  process.exit(1)
}

console.log('\n── Ждём завершения прогона (опрашиваем карточку, как это делает фронт)')
const started = Date.now()
let card
for (let i = 1; i <= 60; i++) {
  card = await req('GET', `/api/reels/${added.json.id}`)
  const status = card.json?.reel?.syncStatus
  if (status !== 'pending') {
    console.log(`   статус «${status}» через ${((Date.now() - started) / 1000).toFixed(0)} с (опросов: ${i})`)
    break
  }
  await new Promise((r) => setTimeout(r, 3000))
}

check('прогон завершился успехом', card.json?.reel?.syncStatus === 'ok', card.json?.reel?.syncStatus)

if (card.json?.reel?.syncStatus !== 'ok') {
  console.log('   ошибка:', card.json?.reel?.syncError)
  process.exit(1)
}

const reel = card.json.reel
const snap = card.json.snapshots[0]

console.log('\n── Живые данные')
console.log(`   автор          @${reel.ownerUsername}`)
console.log(`   просмотров     ${snap.views}`)
console.log(`   лайков         ${snap.likes}`)
console.log(`   комментариев   ${snap.comments}`)
console.log(`   опубликован    ${reel.postedAt}`)
console.log(`   длительность   ${reel.durationSec} с`)

console.log('\n── Сверка со схемой')
check('автор совпал с фикстурой', reel.ownerUsername === fixture.ownerUsername)
check('дата публикации совпала', reel.postedAt?.slice(0, 19) === String(fixture.timestamp).slice(0, 19))
check('просмотры — число', typeof snap.views === 'number' && snap.views > 0, String(snap.views))
check('обложка получена', Boolean(reel.thumbnailSrc))
check('снапшот записан ровно один', card.json.snapshots.length === 1)
check('назначен следующий опрос', Boolean(reel.nextSyncAt))

console.log('\n── Данные живые, а не из фикстуры')
const delta = snap.views - Number(fixture.videoPlayCount)
check(
  'просмотры изменились с момента выгрузки',
  delta !== 0,
  `${delta > 0 ? '+' : ''}${delta} за ${((Date.now() - Date.parse('2026-08-23T19:05:01Z')) / 3.6e6).toFixed(1)} ч`,
)

console.log(failed ? `\n❌ Провалов: ${failed}\n` : '\n✅ Живой Apify сверен\n')
process.exit(failed ? 1 : 0)
