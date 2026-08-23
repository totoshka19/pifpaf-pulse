import type { ReelListRow } from '@/db/queries/list-reels'

/**
 * Сортировка, поиск и фильтр периода — на клиенте, над уже загруженным списком.
 *
 * У блогера десятки рилсов, и отфильтровать их в браузере — доли миллисекунды.
 * Ходить за этим на сервер значило бы будить Neon после автосуспенда на каждое
 * нажатие клавиши: на free tier это лишняя секунда на ровном месте.
 */

/**
 * Зеркал `ReelSort` по членам, но это разные типы. `ReelSort` — охранник SQL,
 * `FeedSort` — состояние браузера. В этом срезе клиент не отправляет сортировку
 * на сервер, поэтому они свободны разойтись потом (серверная-only или браузер-only).
 */
export type FeedSort = 'added' | 'date' | 'views' | 'growth'
export type FeedRange = 'all' | '7d' | '30d'
export type FeedView = 'grid' | 'table'

export type FeedState = {
  sort: FeedSort
  range: FeedRange
  text: string
  view: FeedView
}

export const DEFAULT_FEED_STATE: FeedState = {
  sort: 'added',
  range: 'all',
  text: '',
  view: 'grid',
}

const DAY = 86_400_000

const RANGE_DAYS: Record<FeedRange, number | null> = {
  all: null,
  '7d': 7,
  '30d': 30,
}

function matches(row: ReelListRow, needle: string): boolean {
  return [row.caption, row.ownerUsername, row.shortcode]
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .toLocaleLowerCase('ru')
    .includes(needle)
}

/** По убыванию, `null` всегда в конце: «нет данных» не должно занимать верх. */
function compareDesc(a: number | null, b: number | null): number {
  if (a === b) return 0
  if (a === null) return 1
  if (b === null) return -1
  return b - a
}

const time = (date: Date | null): number | null => (date ? date.getTime() : null)

export function applyFeed(
  rows: ReelListRow[],
  state: FeedState,
  now: Date,
): ReelListRow[] {
  const needle = state.text.trim().toLocaleLowerCase('ru')
  const days = RANGE_DAYS[state.range]

  // filter всегда отдаёт новый массив — сортировать его на месте безопасно,
  // исходный из состояния React не пострадает.
  const shown = rows.filter((row) => {
    if (needle && !matches(row, needle)) return false
    if (days === null) return true

    // Рилс без даты ещё грузится. Спрятать его фильтром — значит показать
    // блогеру, что вставка ссылки не сработала.
    if (!row.postedAt) return true

    return now.getTime() - row.postedAt.getTime() <= days * DAY
  })

  return shown.sort((a, b) => {
    switch (state.sort) {
      case 'views':
        return compareDesc(a.views, b.views)
      case 'growth':
        return compareDesc(a.growth7d, b.growth7d)
      case 'date':
        return compareDesc(time(a.postedAt), time(b.postedAt))
      default:
        return compareDesc(a.createdAt.getTime(), b.createdAt.getTime())
    }
  })
}
