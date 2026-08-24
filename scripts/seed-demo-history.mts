/**
 * Дорисовывает ИСТОРИЮ снапшотов тестовому кабинету.
 *
 *   npm run seed:demo -- demo@example.invalid
 *
 * Зачем. Свежедобавленный рилс имеет ровно один снапшот, и все графики среза 6
 * вырождаются в точку: прирост за неделю честно равен null, динамика — одна
 * засечка, роста не видно. Проверить график на таких данных нельзя, а живая
 * история набегает только за неделю реального времени.
 *
 * Скрипт НЕ ходит в Apify и не тратит бюджет: он берёт текущие метрики рилса
 * и раскладывает назад по дням правдоподобную кривую роста — быстрый набор
 * в первые сутки, затухание дальше, как ведут себя настоящие рилсы.
 *
 * ТОЛЬКО для тестовых кабинетов. Адрес обязателен и обязан быть на
 * `@example.invalid` или `@example.test`: база общая с продом, и промахнуться
 * по живому блогеру нельзя.
 *
 * Расширение .mts, а не .ts: в package.json нет "type": "module", и файл
 * с top-level await загрузился бы как CommonJS.
 */
import { eq } from 'drizzle-orm'
import { db } from '../src/db/index'
// Прямой импорт таблиц: ESM не видит реэкспорты `export * from './schema'`
// сквозь границу с CJS. Грабли записаны в AGENTS.md.
import { reels, reelSnapshots, users } from '../src/db/schema'

const email = process.argv[2]

if (!email) {
  console.error('Укажи адрес: npm run seed:demo -- demo@example.invalid')
  process.exit(1)
}

if (!/@example\.(invalid|test)$/.test(email)) {
  console.error(`Отказываюсь: «${email}» не тестовый адрес.`)
  console.error('База общая с продом — сеять историю можно только на @example.invalid или @example.test.')
  process.exit(1)
}

/** Сколько дней истории дорисовать. */
const DAYS = 21

const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email))

if (!user) {
  console.error(`Кабинета ${email} нет в базе.`)
  process.exit(1)
}

const rows = await db
  .select({ id: reels.id, shortcode: reels.shortcode, postedAt: reels.postedAt })
  .from(reels)
  .where(eq(reels.userId, user.id))

if (rows.length === 0) {
  console.error(`В кабинете ${email} нет рилсов. Сначала добавь ссылки через /app/reels.`)
  process.exit(1)
}

console.log(`Кабинет ${email}: ${rows.length} рилсов, дорисовываю ${DAYS} дней истории.\n`)

const DAY_MS = 86_400_000

for (const reel of rows) {
  // Последний снапшот — «сегодняшняя правда», от неё и пляшем назад.
  const existing = await db
    .select({
      views: reelSnapshots.views,
      likes: reelSnapshots.likes,
      comments: reelSnapshots.comments,
      capturedAt: reelSnapshots.capturedAt,
    })
    .from(reelSnapshots)
    .where(eq(reelSnapshots.reelId, reel.id))

  const latest = existing.sort((a, b) => b.capturedAt.getTime() - a.capturedAt.getTime())[0]

  if (!latest?.views) {
    console.log(`  ${reel.shortcode}: пропускаю, просмотров ещё нет`)
    continue
  }

  // Чистим прошлые прогоны этого скрипта, чтобы история не наслаивалась.
  await db.delete(reelSnapshots).where(eq(reelSnapshots.reelId, reel.id))

  let written = 0

  // Историю растягиваем на ВОЗРАСТ рилса, а не на фиксированные DAYS.
  // Рилс, выложенный позавчера, не может иметь трёхнедельной истории —
  // а именно так и выглядят настоящие фикстуры: им по одному-семь дней.
  const ageDays = reel.postedAt
    ? Math.min(DAYS, Math.floor((Date.now() - reel.postedAt.getTime()) / DAY_MS))
    : DAYS

  const span = Math.max(1, ageDays)

  for (let daysAgo = span; daysAgo >= 0; daysAgo--) {
    const age = span - daysAgo

    // Кривая насыщения: просмотры набираются быстро в первые дни, дальше
    // рост затухает. Грубо, но похоже на правду, и этого достаточно.
    const scale = (1 - Math.exp(-(age + 0.35) / (span / 2.5))) / (1 - Math.exp(-(span + 0.35) / (span / 2.5)))

    // Пропускаем часть дней у старых рилсов: настоящее расписание опроса
    // адаптивное (PLAN.md §7), и дыры в истории — норма. Заодно эти дыры
    // проверяют протягивание значений в графике динамики.
    if (age > 0 && age < span && span > 10 && age % 3 === 1) continue

    const at = new Date(Date.now() - daysAgo * DAY_MS)

    // Не сеем снапшот раньше публикации: рилса тогда ещё не существовало.
    if (reel.postedAt && at < reel.postedAt) continue

    await db.insert(reelSnapshots).values({
      reelId: reel.id,
      views: Math.max(1, Math.round(latest.views * scale)),
      likes: latest.likes === null ? null : Math.max(0, Math.round(latest.likes * scale)),
      comments:
        latest.comments === null ? null : Math.max(0, Math.round(latest.comments * scale)),
      capturedAt: at,
    })

    written++
  }

  console.log(`  ${reel.shortcode}: ${written} снапшотов, финал ${latest.views.toLocaleString('ru-RU')}`)
}

console.log('\nГотово. Открой /app — графики должны ожить.')
process.exit(0)
