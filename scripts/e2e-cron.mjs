/**
 * Сквозная проверка фоновой синхронизации на запущенном дев-сервере.
 *
 *   npm run dev       # в одном окне
 *   npm run e2e:cron  # в другом
 *
 * Проверяется то, чего не видят ни юнит-, ни интеграционные тесты: что
 * рилс проходит путь `pending → ok` БЕЗ ЕДИНОГО ДЕЙСТВИЯ пользователя,
 * что ключ действительно закрывает эндпоинт, что тик укладывается в
 * бюджет функции Netlify и что обе дыры в расходе бюджета закрыты.
 *
 * Тексты сверяются здесь, а не в curl: консоль Windows портит кириллицу
 * и даёт ложный результат в обе стороны.
 *
 * ОТКЛОНЕНИЕ ОТ ПЛАНА, ОСОЗНАННОЕ. План предлагал ходить в базу через
 * Drizzle (`import { db } from '../src/db/index.ts'`). Из `.mjs` это не
 * работает: `src/db/index.ts` тянет алиас `@/`, который node не резолвит,
 * а `export *` не виден сквозь границу с CJS — записанные грабли проекта.
 * Соседи по семейству `e2e:*` — все `.mjs` и ходят в базу сырым
 * `postgres` (см. `db-check.mjs`), Drizzle живёт в `.mts` под `tsx`
 * (см. `backfill-thumbnails.mts`). Скрипту нужны три обращения к базе,
 * все тривиальные, — берём конвенцию семейства, а не тащим `tsx` в
 * сквозную проверку ради одного UPDATE.
 */
import postgres from 'postgres'

const BASE = process.env.E2E_BASE ?? 'http://localhost:3000'
const SECRET = process.env.CRON_SECRET
const CODE = 'DcXVbOOiyhL'
const URL_ = `https://www.instagram.com/reel/${CODE}/`

if (!SECRET) {
  console.error('Нет CRON_SECRET. Запускать через npm run e2e:cron — он подставляет .env.local')
  process.exit(1)
}

const sql = postgres(process.env.DATABASE_URL, { prepare: false })

let failed = 0
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${label}${detail ? ': ' + detail : ''}`)
  if (!ok) failed++
}

const tick = async (auth = `Bearer ${SECRET}`) => {
  const r = await fetch(`${BASE}/api/cron/sync`, {
    method: 'POST',
    headers: auth ? { authorization: auth } : {},
  })
  const json = await r.json().catch(() => ({}))
  return { status: r.status, ...json }
}

console.log('\n── Ключ')
check('без заголовка — 401', (await tick(null)).status === 401)
check('с чужим ключом — 401', (await tick('Bearer nonsense')).status === 401)
check('с верным ключом — 200', (await tick()).status === 200)

console.log('\n── Полный цикл на фикстурах')
const email = `cron-${Date.now()}@example.invalid`
const reg = await fetch(`${BASE}/api/auth/register`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email, password: 'parolparol1', displayName: 'Крон' }),
})
const cookie = reg.headers.get('set-cookie').split(';')[0]
const H = { 'content-type': 'application/json', cookie }

const added = await fetch(`${BASE}/api/reels`, {
  method: 'POST', headers: H, body: JSON.stringify({ url: URL_ }),
})
const { id: reelId } = await added.json()
check('рилс добавлен', added.status === 202, String(added.status))

// Сначала даём крону ДОБРАТЬ прогон, заведённый самим добавлением.
//
// План просрочивал рилс сразу после добавления — и проверка «тик 1 запустил
// батч» падала, показывая `collected: 1, started: 0`. Причина не в кроне:
// добавление заводит РУЧНОЙ прогон и оставляет рилс в pending, а тик идёт
// фазами «сначала собрать, потом запустить». Фаза сбора подбирает этот
// ручной прогон, `ingestReel` переставляет next_sync_at в будущее — и к
// фазе запуска рилс уже не просрочен. Насильственный сдвиг просто
// затирался законным.
//
// Поэтому цикл крона начинается с чистого листа: сначала тик добирает
// ручной прогон, и только потом рилс просрочивается.
await new Promise((r) => setTimeout(r, 3000))
const zero = await tick()
check('тик 0 добрал прогон от добавления', zero.collected >= 1, JSON.stringify(zero))

// Сдвинуть next_sync_at в прошлое через API нельзя, на то оно и расписание.
await sql`
  UPDATE reels SET next_sync_at = ${new Date(Date.now() - 3_600_000)} WHERE id = ${reelId}
`

const one = await tick()
check('тик 1 запустил батч', one.started >= 1, JSON.stringify(one))

const two = await tick()
check('тик 2 забрал данные', two.collected >= 1, JSON.stringify(two))

const [after] = await sql`SELECT sync_status, next_sync_at FROM reels WHERE id = ${reelId}`
check('рилс вышел в ok', after.sync_status === 'ok', after.sync_status)
check('расписание сдвинуто в будущее', after.next_sync_at > new Date())

// План проверял тик 3 через `started === 0` по всей базе. База общая с
// продом, и чужой просроченный рилс сделал бы проверку красной по причине,
// к этому сценарию не относящейся. Спрашиваем ровно то, что проверяем:
// НАШ рилс второй раз не оплачен — новых строк sync_runs у него не завелось.
const runsBefore = await sql`SELECT count(*)::int AS n FROM sync_runs WHERE reel_id = ${reelId}`
await tick()
const runsAfter = await sql`SELECT count(*)::int AS n FROM sync_runs WHERE reel_id = ${reelId}`
check('тик 3 не берёт тот же рилс повторно', runsBefore[0].n === runsAfter[0].n,
  `${runsBefore[0].n} → ${runsAfter[0].n}`)

console.log('\n── Прогон крона помечен как крон')
const runs = await sql`SELECT triggered_by FROM sync_runs WHERE reel_id = ${reelId}`
check('есть строка с triggered_by = cron', runs.some((r) => r.triggered_by === 'cron'))
check('есть строка с triggered_by = manual', runs.some((r) => r.triggered_by === 'manual'))

console.log('\n── Время тика укладывается в бюджет функции')
for (const [label, t] of [['тик 1', one], ['тик 2', two]]) {
  check(`${label} быстрее 8 с`, typeof t.ms === 'number' && t.ms < 8000, `${t.ms} мс`)
}

console.log('\n── Лимит на пользователя')
const email2 = `cron-rate-${Date.now()}@example.invalid`
const reg2 = await fetch(`${BASE}/api/auth/register`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: email2, password: 'parolparol1', displayName: 'Лимит' }),
})
const cookie2 = reg2.headers.get('set-cookie').split(';')[0]
const H2 = { 'content-type': 'application/json', cookie: cookie2 }

const codes = ['AaAaAaAaAaA', 'BbBbBbBbBbB', 'CcCcCcCcCcC', 'DdDdDdDdDdD', 'EeEeEeEeEeE', 'FfFfFfFfFfF']
const statuses = []
for (const code of codes) {
  const r = await fetch(`${BASE}/api/reels`, {
    method: 'POST', headers: H2,
    body: JSON.stringify({ url: `https://www.instagram.com/reel/${code}/` }),
  })
  statuses.push({ status: r.status, body: await r.json().catch(() => ({})) })
}
check('пятое добавление ещё проходит', statuses[4].status === 202, String(statuses[4].status))
check('шестое — 429', statuses[5].status === 429, String(statuses[5].status))
check('в отказе русский текст без кода',
  /[а-яё]/i.test(statuses[5].body.error ?? '') && !/\d{3}/.test(statuses[5].body.error ?? ''),
  statuses[5].body.error)

console.log('\n── Дыра «удалил → вставил заново» закрыта')
// Пауза намеренная. Без неё повторная вставка упрётся в лимит на
// пользователя, а не в часовой троттлинг, и проверка окажется зелёной по
// неверной причине — классическая ловушка «тест проходит, но проверяет не то».
console.log('  (ждём минуту, пока истечёт окно лимита на пользователя)')
await new Promise((r) => setTimeout(r, 61_000))
await fetch(`${BASE}/api/reels/${reelId}`, { method: 'DELETE', headers: H })
const readd = await fetch(`${BASE}/api/reels`, {
  method: 'POST', headers: H, body: JSON.stringify({ url: URL_ }),
})
const readdBody = await readd.json().catch(() => ({}))
check('повторная вставка троттлится', readd.status === 429,
  `${readd.status} ${readdBody.error ?? ''}`)

// Уборка за собой, а не список для ручного удаления: тестовые аккаунты
// копятся в общей с продом базе при каждом прогоне — записанный хвост
// проекта. На ПРОВАЛЕ не убираем: состояние базы и есть улика.
if (failed === 0) {
  const removed = await sql`DELETE FROM users WHERE email IN (${email}, ${email2}) RETURNING email`
  console.log('\n── Уборка')
  console.log(`  удалено тестовых аккаунтов: ${removed.length}`)
} else {
  console.log('\n── Тестовые аккаунты этого прогона (НЕ удалены, состояние базы — улика)')
  for (const e of [email, email2]) console.log(`  ${e}`)
}

await sql.end()
console.log(failed ? `\n${failed} проверок упало` : '\nВсе проверки прошли')
process.exit(failed ? 1 : 0)
