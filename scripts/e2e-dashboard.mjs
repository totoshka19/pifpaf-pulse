/**
 * Сквозная проверка дашборда, экрана рилса и личного кабинета
 * на запущенном дев-сервере.
 *
 *   npm run dev            # в одном окне
 *   npm run e2e:dashboard  # в другом
 *
 * Проверяется то, чего юнит-тесты не видят: настоящие коды ответов,
 * изоляция между кабинетами и то, что смена пароля действительно
 * состоялась. Тексты сверяются здесь, а не в curl: консоль Windows
 * портит кириллицу и даёт ложный результат в обе стороны.
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
      redirect: 'manual',
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

    return { status: response.status, json, text, location: response.headers.get('location') }
  }

  return call
}

const stamp = Date.now()
const owner = session()
const stranger = session()
const rookie = session()
const guest = session()

const OWNER_EMAIL = `dash-owner-${stamp}@example.invalid`
const STRANGER_EMAIL = `dash-stranger-${stamp}@example.invalid`
const ROOKIE_EMAIL = `dash-rookie-${stamp}@example.invalid`
const PASSWORD = 'parolparol1'
const NEW_PASSWORD = 'novyiparol22'

console.log('\n── Подготовка')

for (const [call, email, name] of [
  [owner, OWNER_EMAIL, 'Владелец'],
  [stranger, STRANGER_EMAIL, 'Чужой'],
  [rookie, ROOKIE_EMAIL, 'Новичок'],
]) {
  const registered = await call('POST', '/api/auth/register', {
    email,
    password: PASSWORD,
    displayName: name,
  })
  check(`регистрация ${name.toLowerCase()}`, registered.status === 201, String(registered.status))
}

console.log('\n── Гостя не пускают никуда')

for (const path of ['/app', '/app/reels', '/app/settings']) {
  const response = await guest('GET', path)
  check(
    `${path} гостем — 307 на /login`,
    response.status === 307 && (response.location ?? '').includes('/login'),
    `${response.status} ${response.location ?? ''}`,
  )
}

const guestPatch = await guest('PATCH', '/api/settings', { displayName: 'Взлом' })
check('PATCH /api/settings гостем — 401', guestPatch.status === 401, String(guestPatch.status))

const guestPassword = await guest('POST', '/api/settings/password', {
  currentPassword: PASSWORD,
  newPassword: NEW_PASSWORD,
})
check(
  'POST /api/settings/password гостем — 401',
  guestPassword.status === 401,
  String(guestPassword.status),
)

console.log('\n── Дашборд новичка без рилсов')

const emptyDashboard = await rookie('GET', '/app')
check('открывается и не падает', emptyDashboard.status === 200, String(emptyDashboard.status))
check(
  'объясняет, что делать, а не показывает нули',
  /Добавить первый рилс/.test(emptyDashboard.text),
)
check(
  'пустых рамок графиков нет',
  !/Динамика просмотров/.test(emptyDashboard.text),
)

console.log('\n── Рилс появляется в KPI')

const added = await owner('POST', '/api/reels', { url: `https://www.instagram.com/reel/${CODES[0]}/` })
check('рилс принят', added.status === 202, String(added.status))
const reelId = added.json.id

// Приём данных идёт фоновым прогоном — дожидаемся выхода из pending.
let card = null
for (let attempt = 0; attempt < 30; attempt++) {
  const response = await owner('GET', `/api/reels/${reelId}`)
  card = response.json.reel
  if (card?.syncStatus !== 'pending') break
  await new Promise((resolve) => setTimeout(resolve, 1000))
}
check('рилс вышел из pending', card?.syncStatus === 'ok', String(card?.syncStatus))

const dashboard = await owner('GET', '/app')
check('дашборд открывается', dashboard.status === 200, String(dashboard.status))
check('KPI показывают один рилс', /1\s*<\/dd>|>1</.test(dashboard.text) || /1 рилс/.test(dashboard.text))
check('пустого состояния больше нет', !/Добавить первый рилс/.test(dashboard.text))

console.log('\n── Диапазон графика: белый список, а не 500')

for (const range of ['7d', '30d', 'all']) {
  const response = await owner('GET', `/app?range=${range}`)
  check(`?range=${range} — 200`, response.status === 200, String(response.status))
}

const garbage = await owner('GET', '/app?range=%27%20OR%201%3D1--')
check(
  'мусор в range — 200, а не 500',
  garbage.status === 200,
  String(garbage.status),
)

console.log('\n── Экран рилса и изоляция')

const own = await owner('GET', `/app/reels/${reelId}`)
check('свой рилс открывается', own.status === 200, String(own.status))
check('на экране есть лог синхронизаций', /Синхронизации/.test(own.text))

const alienPage = await stranger('GET', `/app/reels/${reelId}`)
check(
  'чужой рилс не отдаёт данные',
  !/Синхронизации/.test(alienPage.text),
  `статус ${alienPage.status}`,
)
/**
 * СТАТУС здесь 200, а не 404, и это ожидаемо.
 *
 * notFound() в Next 16 отдаёт «мягкую» 404: ответ уже начал стримиться,
 * заголовки ушли, и код изменить нельзя — вместо этого в разметку
 * впрыскивается noindex. Документация прямо это описывает
 * (docs/01-app/03-api-reference/04-functions/not-found.md).
 *
 * Требование изоляции при этом выполнено: чужой рилс и несуществующий
 * неотличимы, данные не протекают. НАСТОЯЩУЮ 404 отдаёт API — она ниже.
 */
check('чужой рилс помечен noindex', /noindex/.test(alienPage.text))

const alienApi = await stranger('GET', `/api/reels/${reelId}`)
check('API на чужой рилс — 404, не 403', alienApi.status === 404, String(alienApi.status))

const ghostApi = await owner('GET', '/api/reels/00000000-0000-4000-8000-000000000000')
check(
  'несуществующий рилс неотличим от чужого',
  ghostApi.status === alienApi.status,
  `${ghostApi.status} и ${alienApi.status}`,
)

console.log('\n── Личный кабинет')

const settings = await owner('GET', '/app/settings')
check('настройки открываются', settings.status === 200, String(settings.status))

const badName = await owner('PATCH', '/api/settings', { displayName: '   ' })
check('пустое имя — 400', badName.status === 400, String(badName.status))
check('текст ошибки по-русски и без кода', /[а-яё]/i.test(badName.json.error ?? '') && !/\b\d{3}\b/.test(badName.json.error ?? ''), badName.json.error)

const saved = await owner('PATCH', '/api/settings', {
  displayName: 'Аня Пиф',
  instagramHandle: 'https://www.instagram.com/PifPafAI/?igsh=abc',
})
check('профиль сохранён', saved.status === 200, String(saved.status))
check('ссылка нормализована в хендл', saved.json.instagramHandle === 'pifpafai', String(saved.json.instagramHandle))

const onlyHandle = await owner('PATCH', '/api/settings', { instagramHandle: 'anya' })
check('имя не затёрлось при правке одного поля', onlyHandle.json.displayName === 'Аня Пиф', String(onlyHandle.json.displayName))

console.log('\n── Смена пароля')

const wrongCurrent = await owner('POST', '/api/settings/password', {
  currentPassword: 'sovsem-ne-tot',
  newPassword: NEW_PASSWORD,
})
check('неверный текущий — 400', wrongCurrent.status === 400, String(wrongCurrent.status))

const stillWorks = await session()('POST', '/api/auth/login', { email: OWNER_EMAIL, password: PASSWORD })
check('после неудачи старый пароль всё ещё работает', stillWorks.status === 200, String(stillWorks.status))

const changed = await owner('POST', '/api/settings/password', {
  currentPassword: PASSWORD,
  newPassword: NEW_PASSWORD,
})
check('смена прошла — 200', changed.status === 200, String(changed.status))

const oldRejected = await session()('POST', '/api/auth/login', { email: OWNER_EMAIL, password: PASSWORD })
check('СТАРЫЙ пароль больше не подходит', oldRejected.status !== 200, String(oldRejected.status))

const newAccepted = await session()('POST', '/api/auth/login', { email: OWNER_EMAIL, password: NEW_PASSWORD })
check('НОВЫЙ пароль подходит', newAccepted.status === 200, String(newAccepted.status))

console.log('\n── Тестовые аккаунты этого прогона (удалить одним запросом)')
for (const email of [OWNER_EMAIL, STRANGER_EMAIL, ROOKIE_EMAIL]) console.log(`  ${email}`)

console.log(failed ? `\n${failed} проверок упало` : '\nВсе проверки прошли')
process.exit(failed ? 1 : 0)
