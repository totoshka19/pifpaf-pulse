import { and, asc, eq, inArray, isNotNull } from 'drizzle-orm'
import { db, reels, syncRuns } from '@/db'
import { ingestReel } from '@/db/queries/ingest'
import { ensureThumbnail } from '@/db/queries/thumbnails'
import { getDatasetItems, getRun } from '@/lib/apify/client'

/**
 * Фоновая синхронизация. Две фазы одного тика, обе ничего не ждут.
 *
 * Ждать завершения прогона внутри одного вызова нельзя: Netlify обрывает
 * функцию через 10 секунд, а прогон Apify идёт 14–19 (замер среза 3).
 * Поэтому тик забирает результаты прогонов, запущенных ПРОШЛЫМ тиком,
 * и стартует новые для следующего.
 */

/**
 * Прогон, висящий дольше этого, считается мёртвым.
 *
 * Шесть часов с запасом больше и самого прогона (19 с), и самой частой
 * ступени расписания (1 ч): живой прогон под этот порог не попадёт никогда.
 * Без порога зависший прогон блокирует свои рилсы навсегда — они остаются
 * в `pending`, а `next_sync_at` у них в будущем.
 */
export const STUCK_RUN_MS = 6 * 3_600_000

/**
 * Сколько `running`-строк разбирает один тик.
 *
 * Групп (уникальных `apify_run_id`) может быть куда больше десяти: у
 * каждой ручной синхронизации свой прогон, то есть своя группа, плюс всё,
 * что не доехало с прошлых тиков. На каждую группу — до двух сетевых
 * кругов (`getRun` + `getDatasetItems`), последовательно, а бюджет всего
 * один — десять секунд Netlify. `ORDER BY started_at ASC` берёт сначала
 * самые старые: они ближе всего к порогу `STUCK_RUN_MS`, и их разумнее
 * разобрать в первую очередь. Значение равно размеру батча фазы запуска
 * (задача 8), чтобы числа по обе стороны тика не расходились.
 */
export const COLLECT_BATCH_SIZE = 10

/**
 * Насколько откладывается автоматическая переопрашивание рилса, чей прогон
 * провалился.
 *
 * `failRuns` не проходит через `computeNextSyncAt` — тот путь только для
 * успеха в `ingestReel`. Без отсрочки `next_sync_at`, выставленный фазой
 * запуска на момент старта прогона, к моменту провала уже в прошлом, и
 * `dueReels` подхватывает рилс почти немедленно: ежечасный повтор — это
 * 24 кредита в сутки с одного рилса, у батча из десяти — уже 240 в сутки.
 * Месячный потолок это не превышает (`tryReserve` держит жёстко
 * независимо), но сливает бюджет заметно быстрее, чем нужно, — та же по
 * форме проблема СКОРОСТИ слива, что и задокументированная дыра «удалил →
 * вставил заново». Ручное «Повторить» у пользователя при этом никто не
 * отнимает — отсрочка касается только автоматического расписания.
 */
export const FAILED_RETRY_MS = 6 * 3_600_000

/**
 * Сколько РАЗ за тик можно звать `ensureThumbnail`.
 *
 * `ensureThumbnail` первым делом делает дешёвый `SELECT` по
 * `reel_thumbnails` и, если обложка уже есть, возвращает `'exists'` без
 * сети и без `sharp` — дорого (0,5–1,8 с, доккомент `thumbnails.ts`)
 * только для рилсов БЕЗ обложки. В установившемся режиме такая почти у
 * всех уже есть, и стоимость тика близка к нулю. Но батч из
 * `COLLECT_BATCH_SIZE` рилсов, из которых у большинства обложки ещё нет
 * (первый приём каждого — редкий, но не невозможный всплеск), мог
 * потребовать до ~18 с только на сеть и выбить тик за границу 10 секунд
 * Netlify — ту же самую, ради которой вообще есть две фазы. Небольшое
 * число режет именно этот наихудший случай, не трогая приём метрик: он
 * от обложки не зависит и идёт независимо от того, исчерпан лимит или нет.
 *
 * Пропущенная попытка не теряется навсегда. Рилс вернулся в расписание
 * (`ingestReel` всегда проставляет `next_sync_at`), и на своей следующей
 * синхронизации он снова пройдёт фазу сбора — а для рилсов, у которых
 * обложка к тому моменту уже появится, `ensureThumbnail` снова обойдётся
 * одним `SELECT`, так что лимит достаётся именно тем, кому он ещё нужен.
 * Для массового долечивания уже есть `scripts/backfill-thumbnails.mts`.
 *
 * ВАЖНО: лимит реализован через СЧЁТЧИК ПОПЫТОК, не через отказ от
 * `await`. Незавершённый (fire-and-forget) промис в serverless — не
 * оптимизация, а тихая потеря: процесс останавливают сразу после ответа,
 * и работа, которая не успела закончиться, просто не выполнится.
 */
export const THUMBNAILS_PER_TICK = 3

/**
 * Фаза 1: забрать результаты завершённых прогонов.
 *
 * Строки группируются по `apify_run_id`, потому что один прогон покрывает
 * весь батч: спрашивать статус и тянуть датасет по разу на каждый рилс
 * значило бы сделать десять одинаковых запросов вместо одного.
 *
 * Внутри группы рилсы закрываются НЕЗАВИСИМО: один битый рилс (нарушение
 * CHECK, переполнение `numeric`, обрыв соединения на конкретной строке)
 * помечается `failed` персонально и не топит соседей по батчу, но и не
 * маскируется под общий `succeeded` — реальный сбой обязан оставить след
 * в `sync_runs.error`, а не тихо потерять рилс в вечном `pending`.
 *
 * Возвращает число рилсов, по которым данные приняты.
 */
export async function collectFinishedRuns(now = new Date()): Promise<number> {
  const running = await db
    .select({
      id: syncRuns.id,
      reelId: syncRuns.reelId,
      apifyRunId: syncRuns.apifyRunId,
      startedAt: syncRuns.startedAt,
    })
    .from(syncRuns)
    .where(and(eq(syncRuns.status, 'running'), isNotNull(syncRuns.apifyRunId)))
    .orderBy(asc(syncRuns.startedAt))
    .limit(COLLECT_BATCH_SIZE)

  const byRun = new Map<string, typeof running>()
  for (const row of running) {
    const key = row.apifyRunId!
    const bucket = byRun.get(key)
    if (bucket) bucket.push(row)
    else byRun.set(key, [row])
  }

  let collected = 0
  // Общий на ВЕСЬ тик, а не на группу: бюджет времени (10 с Netlify)
  // общий для всех групп, значит и счётчик попыток должен быть один.
  let thumbnailAttempts = 0

  for (const [apifyRunId, rows] of byRun) {
    const ids = rows.map((r) => r.id)
    const oldest = Math.min(...rows.map((r) => r.startedAt.getTime()))

    if (now.getTime() - oldest > STUCK_RUN_MS) {
      await failRuns(ids, 'Прогон не завершился за отведённое время', now)
      continue
    }

    let handle
    try {
      handle = await getRun(apifyRunId)
    } catch {
      // Apify недоступен — не трогаем ничего, следующий тик повторит.
      continue
    }

    if (handle.status === 'RUNNING') continue

    if (handle.status === 'FAILED' || !handle.datasetId) {
      await failRuns(ids, 'Прогон Apify завершился ошибкой', now)
      continue
    }

    let items: unknown[]
    try {
      items = await getDatasetItems(handle.datasetId)
    } catch {
      // Симметрично getRun выше: транзиентный отказ именно на датасете
      // (обрыв сети, битый json(), 5xx) — не повод ронять всю фазу сбора
      // и вместе с ней остальные группы. Прогон остаётся running, следующий
      // тик повторит целиком — и статус, и датасет.
      continue
    }

    const failedRows: number[] = []

    for (const row of rows) {
      // reel_id стал NULL — рилс удалили, пока прогон шёл. Принимать данные
      // некуда, но прогон всё равно надо закрыть.
      if (!row.reelId) continue

      try {
        await ingestReel(row.reelId, items, now)
        collected++

        // Обложка — не критичный путь: метрики уже записаны, статус уже ok.
        // Ошибку глотаем: ссылки Instagram протухают, и терять цифры из-за
        // мёртвой картинки — плохой обмен (символ по символу тот же приём,
        // что в advanceIfPending). THUMBNAILS_PER_TICK ограничивает не
        // сам приём (он идёт всегда), а число ПОПЫТОК забрать обложку —
        // после исчерпания лимита просто перестаём звать ensureThumbnail
        // до конца тика; пропущенный рилс не потерян, он вернётся в
        // расписание и получит свою попытку на следующей синхронизации.
        if (thumbnailAttempts < THUMBNAILS_PER_TICK) {
          thumbnailAttempts++
          await ensureThumbnail(row.reelId).catch(() => {})
        }
      } catch (error) {
        failedRows.push(row.id)
        // Реальный сбой приёма обязан оставить след: тихий catch раньше
        // делал прогон succeeded, а рилс — навсегда pending без единого
        // сигнала о том, что что-то пошло не так.
        console.error('[cron] приём рилса упал', row.reelId, error)
      }
    }

    const succeededIds = ids.filter((id) => !failedRows.includes(id))

    if (succeededIds.length > 0) {
      await db
        .update(syncRuns)
        .set({ status: 'succeeded', finishedAt: now })
        .where(inArray(syncRuns.id, succeededIds))
    }

    if (failedRows.length > 0) {
      await failRuns(failedRows, 'Не получилось принять данные рилса', now)
    }
  }

  return collected
}

async function failRuns(ids: number[], error: string, now: Date): Promise<void> {
  await db
    .update(syncRuns)
    .set({ status: 'failed', error, finishedAt: now })
    .where(inArray(syncRuns.id, ids))

  // Рилсы этих прогонов остаются в pending без надежды продвинуться.
  // Переводим в failed, чтобы их забрал существующий путь «Повторить».
  const rows = await db
    .select({ reelId: syncRuns.reelId })
    .from(syncRuns)
    .where(inArray(syncRuns.id, ids))

  const reelIds = rows.map((r) => r.reelId).filter((id): id is string => id !== null)
  if (reelIds.length === 0) return

  await db
    .update(reels)
    .set({
      syncStatus: 'failed',
      syncError: 'Не получилось забрать данные. Попробуй обновить рилс ещё раз',
      // Без отсрочки next_sync_at остаётся в прошлом (его выставила фаза
      // запуска на момент старта), и dueReels подхватывает рилс почти
      // немедленно — ежечасный повтор вместо однократного провала.
      // FAILED_RETRY_MS задерживает только АВТОМАТИЧЕСКОЕ расписание,
      // ручное «Повторить» у пользователя работает как обычно.
      nextSyncAt: new Date(now.getTime() + FAILED_RETRY_MS),
    })
    .where(
      and(
        inArray(reels.id, reelIds),
        // Симметрично advanceIfPending: там демоция в failed загорожена
        // проверкой `if (reel.syncStatus === 'pending')` на вызывающей
        // стороне (src/app/api/reels/[id]/route.ts). Здесь та же гарантия
        // нужна явно: рилс мог успеть стать `ok` через свежий ручной синк,
        // пока этот прогон (уже неактуальный) наконец дотянул до порога —
        // гасить в failed уже подтверждённые свежие данные нельзя.
        eq(reels.syncStatus, 'pending'),
      ),
    )
}
