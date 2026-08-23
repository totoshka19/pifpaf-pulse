import type { ReelListRow } from '@/db/queries/list-reels'

/**
 * Приведение строки ленты к единому виду.
 *
 * Серверный компонент передаёт в остров настоящие `Date` — формат RSC это
 * умеет. `GET /api/reels` отдаёт тот же ряд в JSON, где даты уже строки.
 * Без единой точки приведения карточка после первого обновления упадёт на
 * `row.postedAt.getTime()`, причём не сразу, а только после мутации.
 */

function toDate(value: unknown): Date | null {
  if (value === null || value === undefined) return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value

  if (typeof value !== 'string' && typeof value !== 'number') return null

  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

export function reviveRow(raw: unknown): ReelListRow {
  const row = raw as Record<string, unknown>
  const createdAt = toDate(row.createdAt)

  // createdAt — не поле, а ось сортировки по умолчанию. Его отсутствие значит,
  // что пришло не то, и молча подставлять «сейчас» нельзя.
  if (!createdAt) throw new Error('В строке ленты нет даты добавления')

  return {
    ...(row as unknown as ReelListRow),
    postedAt: toDate(row.postedAt),
    lastSyncedAt: toDate(row.lastSyncedAt),
    capturedAt: toDate(row.capturedAt),
    createdAt,
  }
}
