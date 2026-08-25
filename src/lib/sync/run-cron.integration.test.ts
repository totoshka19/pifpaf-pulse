import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db, reels, syncRuns, users } from '@/db'
import { readThumbnail } from '@/db/queries/thumbnails'
import {
  MOCK_NO_DATASET,
  MOCK_RUN_FAILED,
  MOCK_THROW_GETRUN,
  MOCK_THROW_START,
} from '@/lib/apify/client'
import {
  collectFinishedRuns,
  FAILED_RETRY_MS,
  runCronTick,
  STUCK_RUN_MS,
  THUMBNAILS_PER_TICK,
} from './run-cron'

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

describe('collectFinishedRuns — лимит попыток на обложку общий на ТИК, не на ГРУППУ (находка 7, уточнение ревью раунда 2)', () => {
  // ПЕРВАЯ версия этого теста (раунд правок 2/5) сажала все четыре
  // кандидата под одним и тем же шорткодом — а значит под одним и тем же
  // apifyRunId, то есть в ОДНУ группу byRun. Она доказывала «не больше
  // трёх попыток внутри группы», а thumbnailAttempts демонстративно
  // вынесен ДО цикла по группам именно ради МЕЖгруппового свойства —
  // и это свойство оставалось непроверенным: тест остался бы зелёным,
  // даже переехав счётчик внутрь цикла по группам (что и подтверждено
  // мутацией ниже).
  //
  // Правка: два РАЗНЫХ шорткода → две РАЗНЫЕ группы. Плюс тот же приём,
  // что и раньше: uq_reels_user_shortcode держит уникальность на паре
  // (user_id, shortcode), не на shortcode отдельно, значит несколько
  // разных пользователей МОГУТ сохранить одну и ту же публичную запись.
  // Комбинация «два шорткода × несколько пользователей» даёт две группы
  // без единой новой фикстуры и без шпиона на internal-вызовы —
  // наблюдаем состояние reel_thumbnails, как и весь остальной набор.
  const OWNERS = [
    'cron-thumb-1@example.invalid',
    'cron-thumb-2@example.invalid',
    'cron-thumb-3@example.invalid',
    'cron-thumb-4@example.invalid',
  ]
  const ownerIds: string[] = []

  beforeAll(async () => {
    for (const email of OWNERS) {
      await db.delete(users).where(eq(users.email, email))
      const [u] = await db
        .insert(users)
        .values({ email, passwordHash: 'x', displayName: 'Обложка' })
        .returning({ id: users.id })
      ownerIds.push(u.id)
    }
  })

  afterAll(async () => {
    for (const email of OWNERS) {
      await db.delete(users).where(eq(users.email, email))
    }
  })

  it('не делает больше THUMBNAILS_PER_TICK попыток суммарно по ДВУМ группам за тик', async () => {
    const base = Date.now()

    // Группа A: FIXTURE_CODE, двое владельцев, started_at строго РАНЬШЕ
    // группы B. running отдаёт строки ORDER BY started_at ASC, а byRun
    // заполняется в том же порядке — значит группа A гарантированно
    // попадёт в byRun ПЕРВОЙ и будет полностью обработана ДО того, как
    // тик вообще дойдёт до группы B.
    const groupA = await Promise.all([
      seedRunningReel(FIXTURE_CODE, new Date(base), ownerIds[0]),
      seedRunningReel(FIXTURE_CODE, new Date(base + 1), ownerIds[1]),
    ])

    // Группа B: ДРУГОЙ реальный шорткод фикстуры → ДРУГОЙ apifyRunId
    // (shortcodesFrom в src/lib/apify/client.ts детерминирует id только
    // шорткодом) → вторая, отдельная группа в byRun. Двое владельцев,
    // started_at заметно позже обоих из группы A.
    const groupB = await Promise.all([
      seedRunningReel(FIXTURE_CODE_SCHEDULE, new Date(base + 1000), ownerIds[2]),
      seedRunningReel(FIXTURE_CODE_SCHEDULE, new Date(base + 1001), ownerIds[3]),
    ])

    const seeded = [...groupA, ...groupB]

    await collectFinishedRuns()

    // Детерминированно, без сетевой зависимости. Группа A обрабатывается
    // первой и тратит 2 из 3 попыток (thumbnailAttempts: 0→1→2). Если
    // счётчик действительно общий на тик (а не свой у каждой группы),
    // группе B, обработанной ВТОРОЙ, остаётся только 1 попытка из двух
    // кандидатов — её вторая строка (groupB[1]) гарантированно исключена:
    // ensureThumbnail для неё вообще не вызывается кодом, значит
    // reel_thumbnails для неё не может появиться НИ ПРИ КАКОМ исходе
    // сети. Именно это свойство — межгрупповое — было непроверено версией
    // теста из раунда 2/5.
    expect(await readThumbnail(groupB[1].reelId)).toBeNull()

    // Верхняя граница по всем четырём (обе группы вместе) — слабее
    // числом, но без сетевой зависимости в другую сторону: сеть могла
    // подвести какую-то из первых THUMBNAILS_PER_TICK попыток (та же
    // оговорка про протухшую CDN-ссылку фикстуры, что и в
    // thumbnails.integration.test.ts), но БОЛЬШЕ лимита попыток код
    // сделать не может ни при каких условиях, суммарно по обеим группам.
    let stored = 0
    for (const { reelId } of seeded) {
      if (await readThumbnail(reelId)) stored++
    }
    expect(stored).toBeLessThanOrEqual(THUMBNAILS_PER_TICK)
  })
})

describe('runCronTick — фаза запуска', () => {
  async function seedDue(code: string, minutesOverdue = 30) {
    const [reel] = await db
      .insert(reels)
      .values({
        userId,
        shortcode: code,
        url: `https://www.instagram.com/reel/${code}/`,
        syncStatus: 'ok',
        nextSyncAt: new Date(Date.now() - minutesOverdue * 60_000),
      })
      .returning({ id: reels.id })
    return reel.id
  }

  it('запускает прогон и пишет строку sync_runs на каждый рилс', async () => {
    const reelId = await seedDue('TickOne')

    const report = await runCronTick()
    expect(report.started).toBeGreaterThanOrEqual(1)

    const runs = await db.select().from(syncRuns).where(eq(syncRuns.reelId, reelId))
    expect(runs).toHaveLength(1)
    expect(runs[0].triggeredBy).toBe('cron')
    expect(runs[0].userId).toBe(userId)
    expect(runs[0].shortcode).toBe('TickOne')
  })

  it('весь батч уходит ОДНИМ прогоном Apify', async () => {
    await seedDue('TickBatchA')
    await seedDue('TickBatchB')

    await runCronTick()

    const runs = await db
      .select({ apifyRunId: syncRuns.apifyRunId, shortcode: syncRuns.shortcode })
      .from(syncRuns)
      .where(eq(syncRuns.userId, userId))

    const batch = runs.filter((r) => r.shortcode?.startsWith('TickBatch'))
    expect(batch).toHaveLength(2)
    // Один прогон на оба рилса: платим за результаты, а не за прогоны,
    // и десять запросов к Apify вместо одного — трата времени функции.
    expect(new Set(batch.map((r) => r.apifyRunId)).size).toBe(1)
  })

  it('сдвигает next_sync_at, чтобы следующий тик не взял тот же рилс', async () => {
    const reelId = await seedDue('TickShift')

    await runCronTick()

    const [reel] = await db.select().from(reels).where(eq(reels.id, reelId))
    expect(reel.nextSyncAt!.getTime()).toBeGreaterThan(Date.now())

    // Второй тик подряд не должен запустить этот рилс повторно.
    const before = await db.select().from(syncRuns).where(eq(syncRuns.reelId, reelId))
    await runCronTick()
    const after = await db.select().from(syncRuns).where(eq(syncRuns.reelId, reelId))
    expect(after.length).toBe(before.length)
  })

  it('уважает размер батча', async () => {
    for (let i = 0; i < 4; i++) await seedDue(`TickLimit${i}`)

    const report = await runCronTick(new Date(), 2)

    expect(report.started).toBeLessThanOrEqual(2)
  })

  it('когда обновлять некого, тик проходит вхолостую без ошибок', async () => {
    // Разгребаем всё, что осталось от прошлых тестов.
    for (let i = 0; i < 5; i++) await runCronTick()

    const report = await runCronTick()

    expect(report.started).toBe(0)
    expect(report.skipped).toBeNull()
  })
})

describe('run-cron — ветки отказа Apify (раунд правок 2/5)', () => {
  // До этого раунда ни одна из четырёх веток обработки отказа Apify не
  // выполнялась НИ РАЗУ ни одним тестом файла: мок в штатном режиме
  // всегда отвечает успехом, а живой Apify тесты не трогают. Именно эти
  // ветки решают, потеряет ли сервис данные и сожжёт ли бюджет при
  // реальном отказе Apify (отозванный токен, переименованный актор,
  // сетевой сбой) — самом вероятном классе сбоя из всех. Зарезервированные
  // шорткоды-маркеры (src/lib/apify/client.ts, MOCK_THROW_START и
  // остальные) включают эти ветки без обращения к живому Apify и без
  // первого `vi.mock` в интеграционном наборе проекта.

  it('startRun бросает исключение → sync_runs закрыт failed, next_sync_at сдвинут, syncStatus не тронут', async () => {
    // Явный слив очереди перед сидом: этот сценарий чувствителен к тому,
    // что в due-батч попадёт РОВНО наш маркерный рилс — иначе марker может
    // утонуть среди того, что осталось от соседних describe-блоков этого
    // файла (общая база, общий userId, общий частичный индекс idx_reels_due).
    for (let i = 0; i < 5; i++) await runCronTick()

    const [reel] = await db
      .insert(reels)
      .values({
        userId,
        shortcode: MOCK_THROW_START,
        url: `https://www.instagram.com/reel/${MOCK_THROW_START}/`,
        syncStatus: 'ok',
        nextSyncAt: new Date(Date.now() - 30 * 60_000),
      })
      .returning({ id: reels.id })

    const before = Date.now()
    const report = await runCronTick()
    expect(report.started).toBe(0)

    const runs = await db.select().from(syncRuns).where(eq(syncRuns.reelId, reel.id))
    expect(runs).toHaveLength(1)
    expect(runs[0].status).toBe('failed')
    expect(runs[0].error).toMatch(/[а-яё]/i)

    const [after] = await db.select().from(reels).where(eq(reels.id, reel.id))
    // Находка 1 (раунд правок 1/5): syncStatus НЕ трогаем — данные рилса
    // никуда не делись, мы просто не смогли сходить за свежими.
    expect(after.syncStatus).toBe('ok')
    expect(after.nextSyncAt!.getTime()).toBeGreaterThan(before + FAILED_RETRY_MS - 10_000)
  })

  it('getRun бросает исключение → прогон остаётся running, следующий тик сможет повторить', async () => {
    const { reelId, runId } = await seedRunningReel(MOCK_THROW_GETRUN)

    // Не должно бросить — catch в collectFinishedRuns обязан проглотить
    // транзиентный отказ getRun и оставить прогон нетронутым.
    await collectFinishedRuns()

    const [run] = await db.select().from(syncRuns).where(eq(syncRuns.id, runId))
    expect(run.status).toBe('running')

    const [reel] = await db.select().from(reels).where(eq(reels.id, reelId))
    expect(reel.syncStatus).toBe('pending')
  })

  it('прогон FAILED → sync_runs закрыт failed, рилс откатывается в failed', async () => {
    const { reelId, runId } = await seedRunningReel(MOCK_RUN_FAILED)

    await collectFinishedRuns()

    const [run] = await db.select().from(syncRuns).where(eq(syncRuns.id, runId))
    expect(run.status).toBe('failed')
    expect(run.error).toMatch(/[а-яё]/i)

    const [reel] = await db.select().from(reels).where(eq(reels.id, reelId))
    expect(reel.syncStatus).toBe('failed')
    expect(reel.syncError).toMatch(/[а-яё]/i)
  })

  it('прогон без datasetId → закрывается как failed, симметрично явному FAILED', async () => {
    const { reelId, runId } = await seedRunningReel(MOCK_NO_DATASET)

    await collectFinishedRuns()

    const [run] = await db.select().from(syncRuns).where(eq(syncRuns.id, runId))
    expect(run.status).toBe('failed')

    const [reel] = await db.select().from(reels).where(eq(reels.id, reelId))
    expect(reel.syncStatus).toBe('failed')
  })
})
