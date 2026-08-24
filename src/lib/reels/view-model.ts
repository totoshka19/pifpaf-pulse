import type { ReelListRow } from '@/db/queries/list-reels'
import { formatDayMsk, formatExactMsk, formatRelative } from '@/lib/format/date'
import { formatCount, formatDelta, formatExact, NO_DATA } from '@/lib/format/number'

/**
 * Единственное место, где решается, ЧТО показывает карточка.
 *
 * Компоненты после этого только подставляют готовые строки: логика «нет данных
 * или ноль», «мало точек для прироста», «какой статус у рилса» живёт здесь
 * и покрыта тестами, а не размазана по вёрстке.
 */

export type ReelState = 'loading' | 'refreshing' | 'ok' | 'failed' | 'unavailable'

export type GrowthBadge = { text: string; direction: 'up' | 'down' }

export type ReelCardModel = {
  id: string
  url: string
  shortcode: string
  state: ReelState
  caption: string
  author: string | null
  /** Момент, когда обложка МОГЛА появиться. Меняется только при успешном приёме. */
  coverVersion: number | null
  views: string
  viewsTitle: string
  likes: string
  comments: string
  er: string
  posted: string
  postedShort: string
  postedTitle: string
  updated: string | null
  growth: GrowthBadge | null
  message: string | null
  canRetry: boolean
  canSync: boolean
}

const MESSAGES: Record<ReelState, string | null> = {
  loading: 'Забираем данные из Instagram…',
  refreshing: 'Обновляем цифры…',
  ok: null,
  failed: 'Не получилось забрать данные',
  unavailable: 'Рилс приватный или удалён',
}

/**
 * Статус в базе — четыре значения, состояний в интерфейсе пять.
 * `pending` расщепляется надвое: первая загрузка выглядит иначе, чем повторный
 * опрос, при котором на экране уже есть цифры.
 */
function stateOf(row: ReelListRow): ReelState {
  if (row.syncStatus === 'pending') return row.capturedAt ? 'refreshing' : 'loading'
  if (row.syncStatus === 'failed') return 'failed'
  if (row.syncStatus === 'unavailable') return 'unavailable'
  return 'ok'
}

/**
 * Вовлечённость в процентах от просмотров.
 *
 * Требует все три числа. `likes === null` означает «автор скрыл счётчик»,
 * а не ноль: посчитать ER без лайков и показать заниженную цифру хуже,
 * чем честно написать «нет данных».
 */
function erOf(row: ReelListRow): string {
  // Пустое значение и ноль отсекаются одной проверкой: ноль просмотров —
  // это ещё и деление на ноль.
  if (!row.views || row.likes === null || row.comments === null) return NO_DATA

  const value = ((row.likes + row.comments) / row.views) * 100
  return `${(Math.round(value * 10) / 10).toString().replace('.', ',')} %`
}

function growthOf(row: ReelListRow): GrowthBadge | null {
  // null — «точек в окне меньше двух» (см. CASE WHEN в list-reels.ts).
  // 0 — «не изменилось»: бейдж «+0» не сообщает ничего.
  if (row.growth7d === null || row.growth7d === 0) return null

  return {
    text: formatDelta(row.growth7d),
    direction: row.growth7d > 0 ? 'up' : 'down',
  }
}

export function toCardModel(row: ReelListRow, now: Date): ReelCardModel {
  const state = stateOf(row)

  return {
    id: row.id,
    url: row.url,
    shortcode: row.shortcode,
    state,
    // Обрезкой длинной подписи занимается CSS (line-clamp): резать в JS значит
    // потерять текст для поиска и для тултипа.
    caption: row.caption?.trim() || 'Без подписи',
    author: row.ownerUsername ? `@${row.ownerUsername}` : null,
    coverVersion: row.lastSyncedAt ? row.lastSyncedAt.getTime() : null,
    views: formatCount(row.views),
    viewsTitle: formatExact(row.views),
    likes: formatCount(row.likes),
    comments: formatCount(row.comments),
    er: erOf(row),
    posted: formatRelative(row.postedAt, now),
    postedShort: formatDayMsk(row.postedAt),
    postedTitle: formatExactMsk(row.postedAt),
    updated: row.lastSyncedAt ? `обновлено ${formatRelative(row.lastSyncedAt, now)}` : null,
    growth: growthOf(row),
    message: state === 'failed' ? (row.syncError ?? MESSAGES.failed) : MESSAGES[state],
    canRetry: state === 'failed',
    // Обновлять здоровый рилс можно; у остальных состояний либо нечего
    // обновлять, либо для этого есть отдельная кнопка «Повторить».
    canSync: state === 'ok',
  }
}
