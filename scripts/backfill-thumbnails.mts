/**
 * Дозаливка обложек для рилсов, добавленных до среза 4.
 *
 *   npm run thumbs:backfill
 *
 * Такие рилсы хранят только `thumbnailSrc` — ссылку на CDN Instagram, которая
 * живёт ~4,5 суток с момента выгрузки. Дальше дозалить будет неоткуда, поэтому
 * гонять стоит вскоре после обновления кода.
 *
 * Вызывает НАСТОЯЩУЮ `ensureThumbnail`, а не свою копию логики: запускается
 * через tsx, который резолвит и типы, и алиас `@/`.
 */
import { and, eq, isNull, sql } from 'drizzle-orm'
import { db } from '../src/db'
// Таблицы берём из схемы напрямую: `src/db/index.ts` реэкспортирует их через
// `export * from './schema'`, а ESM не видит такие реэкспорты сквозь границу
// с CommonJS — файл без расширения .mts трактуется как CJS.
import { reels, reelThumbnails } from '../src/db/schema'
import { ensureThumbnail } from '../src/db/queries/thumbnails'

/** Скачивание идёт 0,5–1,8 с на картинку — за прогон берём разумную порцию. */
const BATCH = Number.parseInt(process.env.BACKFILL_LIMIT ?? '20', 10)

/** Пауза между картинками: не долбить CDN очередью. */
const PAUSE_MS = 200

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const pending = await db
  .select({ id: reels.id, shortcode: reels.shortcode, src: reels.thumbnailSrc })
  .from(reels)
  .leftJoin(reelThumbnails, eq(reelThumbnails.reelId, reels.id))
  .where(and(eq(reels.syncStatus, 'ok'), isNull(reelThumbnails.reelId)))
  .limit(BATCH)

if (pending.length === 0) {
  console.log('\nВсе обложки на месте — дозаливать нечего.\n')
  process.exit(0)
}

console.log(`\nРилсов без обложки: ${pending.length} (лимит за прогон ${BATCH})\n`)

const tally = { stored: 0, exists: 0, skipped: 0 }

for (const [index, reel] of pending.entries()) {
  const started = Date.now()
  const result = await ensureThumbnail(reel.id)
  tally[result]++

  const mark = result === 'stored' ? '✅' : result === 'exists' ? '·' : '⚠️'
  const note = result === 'skipped' && !reel.src ? 'нет ссылки' : result === 'skipped' ? 'ссылка мертва' : ''

  console.log(
    `  ${mark} ${String(index + 1).padStart(2)}/${pending.length} ${reel.shortcode.padEnd(13)} ${result}${note ? ' — ' + note : ''} (${Date.now() - started} мс)`,
  )

  if (index < pending.length - 1) await sleep(PAUSE_MS)
}

const [totals] = await db
  .select({
    count: sql<number>`count(*)::int`,
    bytes: sql<number>`coalesce(sum(${reelThumbnails.bytes}), 0)::int`,
  })
  .from(reelThumbnails)

console.log(`\nСкачано ${tally.stored}, уже было ${tally.exists}, пропущено ${tally.skipped}`)
console.log(
  `Всего обложек в базе: ${totals.count}, вес ${(totals.bytes / 1024).toFixed(0)} КБ` +
    (totals.count ? ` (в среднем ${(totals.bytes / totals.count / 1024).toFixed(0)} КБ)` : ''),
)

if (tally.skipped > 0) {
  console.log(
    '\n⚠️  Пропущенные — это мёртвые ссылки Instagram. Обложки для них взять неоткуда,\n' +
      '   <ReelCover> покажет плейсхолдер. При следующей синхронизации придёт свежая ссылка.',
  )
}

console.log()
process.exit(0)
