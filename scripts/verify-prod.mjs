/**
 * Проверка прода: режим Apify, обложки, sharp на Linux.
 *
 *   npm run verify:prod
 *
 * Режим определяется по идентификатору прогона в sync_runs: мок пишет префикс
 * "mock:", живой Apify — настоящий id вроде 8hfooOUZXemlF4NzK. База у прода
 * и у разработки одна, поэтому смотреть можно прямо в неё.
 *
 * Если прод в живом режиме — тратит 1 кредит Apify.
 */
import postgres from 'postgres'

const BASE = process.env.PROD_BASE ?? 'https://iridescent-biscuit-442fa5.netlify.app'
const REEL = 'https://www.instagram.com/reel/DcXVbOOiyhL/'
const MARKER = `prodcheck.${Date.now()}@example.invalid`

const sql = postgres(process.env.DATABASE_URL_UNPOOLED, { prepare: false })

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
    return { status: response.status, json: JSON.parse(text), headers: response.headers }
  } catch {
    return { status: response.status, json: text, headers: response.headers }
  }
}

let failed = 0
const check = (label, condition, detail = '') => {
  console.log(`  ${condition ? '✅' : '❌'} ${label}${detail ? ': ' + detail : ''}`)
  if (!condition) failed++
}

try {
  console.log(`\nПрод: ${BASE}\n`)

  console.log('── Регистрация')
  const reg = await req('POST', '/api/auth/register', {
    email: MARKER,
    password: 'парольДляПроверки',
    displayName: 'Проверка прода',
  })
  check('регистрация работает', reg.status === 201, `HTTP ${reg.status}`)
  if (reg.status !== 201) process.exit(1)

  console.log('\n── Добавление рилса')
  const added = await req('POST', '/api/reels', { url: REEL })
  check('вставка принята', added.status === 202, `HTTP ${added.status}`)
  if (added.status !== 202) {
    console.log('   ответ:', JSON.stringify(added.json))
    process.exit(1)
  }

  console.log('\n── Режим Apify на проде')
  const [run] = await sql`
    SELECT apify_run_id FROM sync_runs WHERE reel_id = ${added.json.id} LIMIT 1
  `
  const isMock = String(run?.apify_run_id ?? '').startsWith('mock:')
  console.log(`   apify_run_id = ${run?.apify_run_id}`)
  check(
    'прод в ЖИВОМ режиме (не мок)',
    !isMock,
    isMock ? 'APIFY_MOCK всё ещё 1 или нет токена' : 'настоящий прогон Apify',
  )

  console.log('\n── Ждём данные')
  let card
  const started = Date.now()
  for (let i = 0; i < 40; i++) {
    card = await req('GET', `/api/reels/${added.json.id}`)
    if (card.json?.reel?.syncStatus !== 'pending') break
    await new Promise((r) => setTimeout(r, 3000))
  }
  const seconds = ((Date.now() - started) / 1000).toFixed(0)
  check('статус ok', card.json?.reel?.syncStatus === 'ok', `${card.json?.reel?.syncStatus} за ${seconds} с`)
  if (card.json?.reel?.syncStatus === 'ok') {
    console.log(`   @${card.json.reel.ownerUsername}, просмотров ${card.json.snapshots[0]?.views}`)
  }

  console.log('\n── Обложка (проверяет sharp на Linux)')
  const image = await fetch(`${BASE}/api/thumbnails/${added.json.id}`, { headers: { cookie } })
  check('HTTP 200', image.status === 200, String(image.status))
  if (image.status === 200) {
    const bytes = Buffer.from(await image.arrayBuffer())
    check('тип image/webp', image.headers.get('content-type') === 'image/webp')
    check(
      'настоящий WebP по сигнатуре — значит sharp собрался на Linux',
      bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP',
    )
    check('вес ужат', bytes.length < 120_000, `${(bytes.length / 1024).toFixed(0)} КБ`)
    check('кеш иммутабельный', (image.headers.get('cache-control') ?? '').includes('immutable'))
  }

  console.log('\n── Уборка')
  await req('DELETE', `/api/reels/${added.json.id}`)
  await sql`DELETE FROM users WHERE email = ${MARKER}`
  const usage = await sql`SELECT period, results FROM apify_usage`
  console.log('   тестовые данные удалены')
  console.log('   счётчик Apify:', usage.length ? JSON.stringify(usage) : 'пусто')
} finally {
  await sql.end()
}

console.log(failed ? `\n❌ Провалов: ${failed}\n` : '\n✅ Прод проверен\n')
process.exit(failed ? 1 : 0)
