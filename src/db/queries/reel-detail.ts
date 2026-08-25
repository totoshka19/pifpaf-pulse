import { and, asc, desc, eq } from 'drizzle-orm'
import { db, reels, reelSnapshots, syncRuns } from '@/db'

export type DetailSnapshot = {
  capturedAt: Date
  views: number | null
  likes: number | null
  comments: number | null
}

export type DetailRun = {
  startedAt: Date
  finishedAt: Date | null
  status: string
  error: string | null
  /** Кто запустил: блогер кнопкой или расписание. */
  triggeredBy: 'manual' | 'cron'
  /** Прогон был на фикстурах, а не на живом Apify. */
  isMock: boolean
}

export type DetailReel = {
  id: string
  shortcode: string
  url: string
  caption: string | null
  ownerUsername: string | null
  postedAt: Date | null
  syncStatus: string
  syncError: string | null
  lastSyncedAt: Date | null
  createdAt: Date
}

export type ReelDetail = {
  reel: DetailReel
  /** По ВОЗРАСТАНИЮ времени: график роста рисуется слева направо. */
  snapshots: DetailSnapshot[]
  /** По УБЫВАНИЮ: свежий прогон сверху, как в любом логе. */
  runs: DetailRun[]
}

/**
 * Всё про один рилс: сам рилс, его снапшоты и лог синхронизаций.
 *
 * Путь ТИПИЗИРОВАННЫЙ (`db.select().from(...)`), а не сырой `db.execute`.
 * Здесь нет аналитики, ради которой стоило бы писать SQL руками, зато есть
 * bigint'ы и timestamptz — а типизированный маппер Drizzle приводит их сам.
 * Сырой путь потребовал бы ручного приведения в четырёх местах ради нулевой
 * выгоды. Витрина сырого SQL — три запроса статистики рядом.
 *
 * `null` означает И «рилса нет», И «рилс чужой». Различать их снаружи нельзя:
 * по разнице ответов перебором идентификаторов можно узнать, какие рилсы
 * вообще заведены в системе. Поэтому фильтр по `user_id` стоит прямо
 * в запросе — не «нашли и потом проверили», а «искали только среди своих».
 */
export async function reelDetail(userId: string, reelId: string): Promise<ReelDetail | null> {
  // Из адресной строки может прийти что угодно, а колонка — uuid: Postgres
  // на мусоре бросает ошибку типа, и без этой проверки кривая ссылка
  // возвращала бы 500 вместо честной 404.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(reelId)) {
    return null
  }

  const [reel] = await db
    .select({
      id: reels.id,
      shortcode: reels.shortcode,
      url: reels.url,
      caption: reels.caption,
      ownerUsername: reels.ownerUsername,
      postedAt: reels.postedAt,
      syncStatus: reels.syncStatus,
      syncError: reels.syncError,
      lastSyncedAt: reels.lastSyncedAt,
      createdAt: reels.createdAt,
    })
    .from(reels)
    .where(and(eq(reels.id, reelId), eq(reels.userId, userId)))

  if (!reel) return null

  // Два запроса параллельно: рилс уже найден, и ждать их по очереди значит
  // добавить лишний круг к холодной базе Neon.
  const [snapshots, runs] = await Promise.all([
    db
      .select({
        capturedAt: reelSnapshots.capturedAt,
        views: reelSnapshots.views,
        likes: reelSnapshots.likes,
        comments: reelSnapshots.comments,
      })
      .from(reelSnapshots)
      .where(eq(reelSnapshots.reelId, reelId))
      .orderBy(asc(reelSnapshots.capturedAt)),

    db
      .select({
        startedAt: syncRuns.startedAt,
        finishedAt: syncRuns.finishedAt,
        status: syncRuns.status,
        error: syncRuns.error,
        triggeredBy: syncRuns.triggeredBy,
        apifyRunId: syncRuns.apifyRunId,
      })
      .from(syncRuns)
      .where(eq(syncRuns.reelId, reelId))
      .orderBy(desc(syncRuns.startedAt)),
  ])

  return {
    reel,
    snapshots,
    runs: runs.map(({ apifyRunId, ...run }) => ({
      ...run,
      // Сам идентификатор наружу не отдаём — блогеру он ничего не говорит,
      // а во внутренние идентификаторы Apify лучше не тыкать пальцем.
      // Признак режима отдаём: строка «данные из фикстур» рядом с прогоном
      // честнее молчания, когда сервис показан в демо-режиме.
      isMock: apifyRunId?.startsWith('mock:') ?? false,
    })),
  }
}
