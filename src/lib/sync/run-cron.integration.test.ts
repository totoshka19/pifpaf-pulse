import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db, reels, syncRuns, users } from '@/db'
import { readThumbnail } from '@/db/queries/thumbnails'
import { collectFinishedRuns, FAILED_RETRY_MS, STUCK_RUN_MS } from './run-cron'

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
 *
 * ВНИМАНИЕ ПРИ ЗАПУСКЕ: `collectFinishedRuns` — ГЛОБАЛЬНЫЙ мутатор без
 * фильтра по пользователю или рилсу (так и задумано, см. доккомент в
 * `run-cron.ts`). Каждый вызов в этом файле трогает ЛЮБЫЕ `running`-строки
 * во ВСЕЙ базе, общей с продом, — включая реальные застрявшие рилсы, если
 * они есть. Это ожидаемо и полезно (натурная проверка), но если однажды
 * `APIFY_MOCK` окажется выключен, тот же файл пойдёт ЖИВЫМИ вызовами Apify
 * по всем реальным прогонам, которые найдёт, — не только по своим.
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

  // Осушаем очередь ДО первого теста, один раз на весь файл (beforeAll
  // выполняется независимо от того, какое подмножество тестов выбрано
  // фильтром -t). Несколько проверок ниже утверждают ТОЧНОЕ число обработанных
  // строк, а не просто «не меньше нуля» — любая чужая running-строка в очереди
  // (реальный застрявший рилс с прода или остаток от прерванного прогона
  // этого же файла) испортила бы точность, будучи посчитанной вместо нашей
  // или вытеснив её за пределы COLLECT_BATCH_SIZE.
  await collectFinishedRuns()
})

afterAll(async () => {
  await db.delete(users).where(eq(users.email, OWNER))
})

async function seedRunningReel(code: string, startedAt = new Date(), ownerId = userId) {
  const [reel] = await db
    .insert(reels)
    .values({
      userId: ownerId,
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
      userId: ownerId,
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

    // Очередь пуста после осушения в beforeAll и до этого момента её никто,
    // кроме нас, не наполнял — значит наша строка ЕДИНСТВЕННАЯ, что видит
    // этот вызов, и точное toBe(1) действительно проверяет НАШ рилс, а не
    // «что угодно, лишь бы не отрицательное» (как было раньше).
    const collected = await collectFinishedRuns()
    expect(collected).toBe(1)

    const [reel] = await db.select().from(reels).where(eq(reels.id, reelId))
    expect(reel.syncStatus).toBe('ok')
    expect(reel.lastSyncedAt).toBeInstanceOf(Date)

    const [run] = await db.select().from(syncRuns).where(eq(syncRuns.id, runId))
    expect(run.status).toBe('succeeded')
    expect(run.finishedAt).toBeInstanceOf(Date)

    // Рилс, впервые принятый фазой сбора (а не advanceIfPending — вкладку
    // никто не открывал), обязан получить обложку прямо здесь: это
    // единственное место, где такой рилс вообще может её получить, иначе
    // она останется плейсхолдером НАВСЕГДА (находка 6 ревью). Если тут
    // 'null' — скорее всего протухла CDN-ссылка в фикстуре (та же оговорка,
    // что и в thumbnails.integration.test.ts), не дефект collectFinishedRuns.
    const thumb = await readThumbnail(reelId)
    expect(thumb).not.toBeNull()
  })

  it('ставит next_sync_at, чтобы рилс вернулся в расписание', async () => {
    const { reelId } = await seedRunningReel(FIXTURE_CODE_SCHEDULE)
    await collectFinishedRuns()

    const [reel] = await db.select().from(reels).where(eq(reels.id, reelId))
    expect(reel.nextSyncAt).toBeInstanceOf(Date)
  })

  it('зависший прогон помечает failed, а не тянет вечно, и откладывает автопереопрос', async () => {
    const stale = new Date(Date.now() - STUCK_RUN_MS - 60_000)
    const { reelId, runId } = await seedRunningReel('StuckCode', stale)

    const before = Date.now()
    await collectFinishedRuns()

    const [run] = await db.select().from(syncRuns).where(eq(syncRuns.id, runId))
    expect(run.status).toBe('failed')
    expect(run.error).toMatch(/[а-яё]/i)

    const [reel] = await db.select().from(reels).where(eq(reels.id, reelId))
    expect(reel.syncStatus).toBe('failed')
    // Находка 5 ревью: без отсрочки next_sync_at остался бы в прошлом
    // (его выставила бы фаза запуска на момент старта), и dueReels забрал
    // бы рилс на следующем же тике — ежечасный повтор вместо однократного
    // провала. Проверяем нижнюю границу с запасом в 5 с на дребезг часов.
    expect(reel.nextSyncAt).toBeInstanceOf(Date)
    expect(reel.nextSyncAt!.getTime()).toBeGreaterThan(before + FAILED_RETRY_MS - 5_000)
  })

  it('не гасит в failed рилс, который уже стал ok через более свежий синк', async () => {
    // Находка 3 ревью: рилс попал в батч, который завис на STUCK_RUN_MS;
    // за это время пользователь обновил его вручную, и рилс успел стать
    // ok со свежими цифрами ДО того, как этот (уже неактуальный) прогон
    // наконец дотянул до порога. Демоция в failed обязана быть загорожена
    // тем же условием, что и в advanceIfPending — свежие данные нельзя
    // погасить старым прогоном, который их даже не видел.
    const stale = new Date(Date.now() - STUCK_RUN_MS - 60_000)
    const { reelId, runId } = await seedRunningReel('AlreadyFixed', stale)

    const freshNextSyncAt = new Date(Date.now() + 3_600_000)
    await db
      .update(reels)
      .set({ syncStatus: 'ok', syncError: null, nextSyncAt: freshNextSyncAt })
      .where(eq(reels.id, reelId))

    await collectFinishedRuns()

    // Сам прогон всё равно закрывается — он действительно завис и висеть
    // вечно не должен, это отдельный факт от состояния рилса.
    const [run] = await db.select().from(syncRuns).where(eq(syncRuns.id, runId))
    expect(run.status).toBe('failed')

    // А рилс — нет: он уже не pending, и failRuns обязан оставить его
    // как есть, вместе с расписанием, которое поставил более свежий синк.
    const [reel] = await db.select().from(reels).where(eq(reels.id, reelId))
    expect(reel.syncStatus).toBe('ok')
    expect(reel.syncError).toBeNull()
    expect(reel.nextSyncAt!.getTime()).toBe(freshNextSyncAt.getTime())
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
    // Очередь к этому моменту содержит ровно нашу одну строку (предыдущий
    // тест на NoRunId её не пополняет: apify_run_id = null туда не проходит
    // фильтр isNotNull вообще) — 0 здесь точный ответ («ни одного рилса не
    // принято»), а не тавтология toBeGreaterThanOrEqual(0), которая была бы
    // верна всегда, что бы ни случилось.
    await expect(collectFinishedRuns()).resolves.toBe(0)

    const [run] = await db.select().from(syncRuns).where(eq(syncRuns.id, runId))
    expect(run.status).toBe('succeeded')
  })
})

describe('collectFinishedRuns — глобальность распространяется и на пользователей', () => {
  // Все пять сценариев выше заведены под ОДНИМ userId — гипотетический
  // WHERE user_id = $ownerId в реализации не покраснел бы ни на одном из
  // них. Собственный аккаунт со своей running-строкой закрывает эту слепую
  // зону напрямую: один тик обязан вылечить обоих пользователей разом.
  const OTHER_OWNER = 'cron-collect-other@example.invalid'
  let otherUserId: string

  beforeAll(async () => {
    await db.delete(users).where(eq(users.email, OTHER_OWNER))
    const [u] = await db
      .insert(users)
      .values({ email: OTHER_OWNER, passwordHash: 'x', displayName: 'Сбор-2' })
      .returning({ id: users.id })
    otherUserId = u.id
  })

  afterAll(async () => {
    await db.delete(users).where(eq(users.email, OTHER_OWNER))
  })

  it('лечит running-строки обоих пользователей в одном тике', async () => {
    // Синтетические шорткоды — фикстуры тут не нужны: свойство, которое
    // проверяет тест (нет фильтра по user_id), не зависит от того, найдёт
    // ли ingestReel совпадение в датасете.
    const mine = await seedRunningReel('CrossUserA', new Date(), userId)
    const theirs = await seedRunningReel('CrossUserB', new Date(), otherUserId)

    await collectFinishedRuns()

    const [runMine] = await db.select().from(syncRuns).where(eq(syncRuns.id, mine.runId))
    const [runTheirs] = await db
      .select()
      .from(syncRuns)
      .where(eq(syncRuns.id, theirs.runId))

    expect(runMine.status).toBe('succeeded')
    expect(runTheirs.status).toBe('succeeded')
  })
})
