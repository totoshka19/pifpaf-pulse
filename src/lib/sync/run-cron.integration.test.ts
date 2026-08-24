import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db, reels, syncRuns, users } from '@/db'
import { collectFinishedRuns, STUCK_RUN_MS } from './run-cron'

/**
 * Фаза 1 крона на ЖИВОЙ базе и МОКЕ Apify.
 *
 * `APIFY_MOCK=1` в `.env.local` означает, что `getRun` всегда отвечает
 * SUCCEEDED, а `getDatasetItems` отдаёт фикстуры. Шорткоды в тесте берутся
 * из `fixtures/apify/` — иначе `ingestReel` не найдёт совпадения и запишет
 * рилсу `unavailable`.
 *
 * НАХОДКА ПРИ ПЕРВОМ ПРОГОНЕ: `reels` несёт `uq_reels_user_shortcode`
 * (userId, shortcode). Черновик этого файла использовал ОДИН `FIXTURE_CODE`
 * в трёх разных `it()` без удаления между ними — второй и третий `seedRunningReel`
 * детерминированно падали на дубликате ключа, независимо от холодного старта
 * Neon (проверено повторным прогоном на уже тёплом соединении: ошибка та же).
 * У фикстуры три разных шорткода — каждому сценарию, которому нужен реальный
 * матч в fixtures/apify/, даём СВОЙ, как и остальные интеграционные тесты
 * проекта делают для (userId, shortcode) (см. sync-state.integration.test.ts).
 */

const OWNER = 'cron-collect@example.invalid'
const FIXTURE_CODE = 'DcXVbOOiyhL'
const FIXTURE_CODE_SCHEDULE = 'DcJsGN3tYER'
const FIXTURE_CODE_DELETED = 'DcYUN9wIWdD'

let userId: string

beforeAll(async () => {
  await db.delete(users).where(eq(users.email, OWNER))
  const [u] = await db
    .insert(users)
    .values({ email: OWNER, passwordHash: 'x', displayName: 'Сбор' })
    .returning({ id: users.id })
  userId = u.id
})

afterAll(async () => {
  await db.delete(users).where(eq(users.email, OWNER))
})

async function seedRunningReel(code: string, startedAt = new Date()) {
  const [reel] = await db
    .insert(reels)
    .values({
      userId,
      shortcode: code,
      url: `https://www.instagram.com/reel/${code}/`,
      syncStatus: 'pending',
    })
    .returning({ id: reels.id })

  // Мок кодирует запрошенные шорткоды прямо в идентификатор прогона:
  // см. shortcodesFrom в src/lib/apify/client.ts.
  const [run] = await db
    .insert(syncRuns)
    .values({
      reelId: reel.id,
      userId,
      shortcode: code,
      triggeredBy: 'cron',
      apifyRunId: `mock:${code}`,
      status: 'running',
      startedAt,
    })
    .returning({ id: syncRuns.id })

  return { reelId: reel.id, runId: run.id }
}

describe('collectFinishedRuns', () => {
  it('забирает данные и переводит рилс в ok', async () => {
    const { reelId, runId } = await seedRunningReel(FIXTURE_CODE)

    const collected = await collectFinishedRuns()
    expect(collected).toBeGreaterThanOrEqual(1)

    const [reel] = await db.select().from(reels).where(eq(reels.id, reelId))
    expect(reel.syncStatus).toBe('ok')
    expect(reel.lastSyncedAt).toBeInstanceOf(Date)

    const [run] = await db.select().from(syncRuns).where(eq(syncRuns.id, runId))
    expect(run.status).toBe('succeeded')
    expect(run.finishedAt).toBeInstanceOf(Date)
  })

  it('ставит next_sync_at, чтобы рилс вернулся в расписание', async () => {
    const { reelId } = await seedRunningReel(FIXTURE_CODE_SCHEDULE)
    await collectFinishedRuns()

    const [reel] = await db.select().from(reels).where(eq(reels.id, reelId))
    expect(reel.nextSyncAt).toBeInstanceOf(Date)
  })

  it('зависший прогон помечает failed, а не тянет вечно', async () => {
    const stale = new Date(Date.now() - STUCK_RUN_MS - 60_000)
    const { runId } = await seedRunningReel('StuckCode', stale)

    await collectFinishedRuns()

    const [run] = await db.select().from(syncRuns).where(eq(syncRuns.id, runId))
    expect(run.status).toBe('failed')
    expect(run.error).toMatch(/[а-яё]/i)
  })

  it('прогон без apify_run_id не трогает: запуск ещё не состоялся', async () => {
    const [reel] = await db
      .insert(reels)
      .values({
        userId,
        shortcode: 'NoRunId',
        url: 'https://x/NoRunId',
        syncStatus: 'pending',
      })
      .returning({ id: reels.id })

    const [run] = await db
      .insert(syncRuns)
      .values({
        reelId: reel.id,
        userId,
        shortcode: 'NoRunId',
        triggeredBy: 'cron',
        apifyRunId: null,
        status: 'running',
      })
      .returning({ id: syncRuns.id })

    await collectFinishedRuns()

    const [after] = await db.select().from(syncRuns).where(eq(syncRuns.id, run.id))
    expect(after.status).toBe('running')
  })

  it('прогон удалённого рилса закрывается без падения', async () => {
    const { reelId, runId } = await seedRunningReel(FIXTURE_CODE_DELETED)
    await db.delete(reels).where(eq(reels.id, reelId))

    // reel_id стал NULL — принимать данные некуда, но и падать нельзя.
    await expect(collectFinishedRuns()).resolves.toBeGreaterThanOrEqual(0)

    const [run] = await db.select().from(syncRuns).where(eq(syncRuns.id, runId))
    expect(run.status).toBe('succeeded')
  })
})
