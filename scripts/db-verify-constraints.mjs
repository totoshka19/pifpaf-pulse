import postgres from 'postgres'

const sql = postgres(process.env.DATABASE_URL_UNPOOLED, { prepare: false })

const tables = await sql`
  SELECT table_name FROM information_schema.tables
  WHERE table_schema = 'public' ORDER BY table_name
`
console.log('Таблицы:', tables.map((t) => t.table_name).join(', '))

const checks = await sql`
  SELECT conname FROM pg_constraint WHERE contype = 'c' AND conname LIKE 'ck_%' ORDER BY conname
`
console.log('CHECK:', checks.map((c) => c.conname).join(', '))

/** Ожидаем, что запрос упадёт. Всё выполняется внутри откатываемой транзакции. */
async function mustReject(label, run) {
  try {
    await sql.begin(async (tx) => {
      await run(tx)
      throw new Error('__rollback__')
    })
    console.log(`   ❌ ${label} — база ПРИНЯЛА, ограничение не работает`)
    return false
  } catch (error) {
    if (error.message === '__rollback__') {
      console.log(`   ❌ ${label} — база ПРИНЯЛА, ограничение не работает`)
      return false
    }
    if (error.code === '23514') {
      console.log(`   ✅ ${label} — отвергнуто (${error.constraint_name})`)
      return true
    }
    console.log(`   ⚠️  ${label} — упало иначе: ${error.code} ${error.message}`)
    return false
  }
}

console.log('\nПроверка ограничений на негодных данных:')

const results = []

results.push(
  await mustReject('users.role = superadmin', (tx) =>
    tx`INSERT INTO users (email, password_hash, display_name, role)
       VALUES ('x@x.ru', 'h', 'X', 'superadmin')`,
  ),
)

results.push(
  await mustReject('apify_usage.period = 2026-8 (без нуля)', (tx) =>
    tx`INSERT INTO apify_usage (period, results) VALUES ('2026-8', 0)`,
  ),
)

results.push(
  await mustReject('apify_usage.results = -5', (tx) =>
    tx`INSERT INTO apify_usage (period, results) VALUES ('2026-08', -5)`,
  ),
)

results.push(
  await mustReject('reels.sync_status = weird', (tx) => {
    return tx`
      WITH u AS (
        INSERT INTO users (email, password_hash, display_name)
        VALUES ('y@y.ru', 'h', 'Y') RETURNING id
      )
      INSERT INTO reels (user_id, shortcode, url, sync_status)
      SELECT id, 'Abcde', 'https://x', 'weird' FROM u
    `
  }),
)

results.push(
  await mustReject('reel_snapshots.views = -1 (скрытая метрика)', (tx) => {
    return tx`
      WITH u AS (
        INSERT INTO users (email, password_hash, display_name)
        VALUES ('z@z.ru', 'h', 'Z') RETURNING id
      ), r AS (
        INSERT INTO reels (user_id, shortcode, url)
        SELECT id, 'Abcdf', 'https://x' FROM u RETURNING id
      )
      INSERT INTO reel_snapshots (reel_id, views) SELECT id, -1 FROM r
    `
  }),
)

console.log('\nПроверка, что валидные данные проходят:')
try {
  await sql.begin(async (tx) => {
    await tx`INSERT INTO users (email, password_hash, display_name, role)
             VALUES ('ok@ok.ru', 'h', 'OK', 'admin')`
    await tx`INSERT INTO apify_usage (period, results) VALUES ('2026-08', 42)`
    throw new Error('__rollback__')
  })
} catch (error) {
  if (error.message === '__rollback__') {
    console.log('   ✅ role=admin и period=2026-08 приняты')
    results.push(true)
  } else {
    console.log(`   ❌ валидные данные отвергнуты: ${error.message}`)
    results.push(false)
  }
}

const left = await sql`SELECT count(*)::int AS n FROM users`
console.log(`\nСтрок в users после отката: ${left[0].n} (должно быть 0)`)

await sql.end()
process.exit(results.every(Boolean) && left[0].n === 0 ? 0 : 1)
