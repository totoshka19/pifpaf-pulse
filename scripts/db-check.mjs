/**
 * Проверка соединения с Neon.
 *
 *   npm run db:check
 *
 * Читает .env.local, подключается по DATABASE_URL и DATABASE_URL_UNPOOLED,
 * печатает, что ответил сервер. Никаких таблиц не трогает.
 */
import postgres from 'postgres'

const targets = [
  ['DATABASE_URL', process.env.DATABASE_URL, 'с пулером — для приложения'],
  ['DATABASE_URL_UNPOOLED', process.env.DATABASE_URL_UNPOOLED, 'без пулера — для миграций'],
]

let failed = false

for (const [name, url, note] of targets) {
  console.log(`\n── ${name} (${note})`)

  if (!url) {
    console.log('   ⚠️  не задан в .env.local')
    failed = true
    continue
  }

  if (url.includes('channel_binding')) {
    console.log('   ❌ в строке остался channel_binding — убери этот параметр,')
    console.log('      иначе PostgreSQL оборвёт соединение с')
    console.log('      FATAL: unrecognized configuration parameter "channel_binding"')
    failed = true
    continue
  }

  const pooled = url.includes('-pooler.')
  const shouldBePooled = name === 'DATABASE_URL'
  if (pooled !== shouldBePooled) {
    console.log(
      `   ❌ ожидался хост ${shouldBePooled ? 'С "-pooler"' : 'БЕЗ "-pooler"'}, а тут наоборот`,
    )
    console.log(
      shouldBePooled
        ? '      Без пулера serverless-функции исчерпают лимит соединений.'
        : '      Через transaction-пулер миграции drizzle-kit ведут себя непредсказуемо.',
    )
    // Соединение при этом установится, но назначение строки неверное —
    // это ошибка, а не замечание. Иначе итог был бы зелёным при явной проблеме.
    failed = true
  }

  const sql = postgres(url, { prepare: false, connect_timeout: 15 })
  try {
    const [row] = await sql`
      SELECT current_database()                                AS db,
             current_user                                      AS role,
             substring(version() from 'PostgreSQL [0-9.]+')    AS server,
             to_char(now() AT TIME ZONE 'Europe/Moscow',
                     'YYYY-MM-DD HH24:MI:SS')                  AS msk
    `
    console.log(`   ✅ база ${row.db}, роль ${row.role}, ${row.server}`)
    console.log(`      время сервера по Москве: ${row.msk}`)
  } catch (error) {
    console.log(`   ❌ не подключилось: ${error.message}`)
    failed = true
  } finally {
    await sql.end({ timeout: 5 })
  }
}

console.log(
  failed
    ? '\nЕсть проблемы — смотри отметки выше.\n'
    : '\nОбе строки рабочие. Можно запускать миграции.\n',
)
process.exit(failed ? 1 : 0)
