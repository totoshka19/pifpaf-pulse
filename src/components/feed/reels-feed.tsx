'use client'

import { useEffect, useMemo, useState } from 'react'
import type { ReelListRow } from '@/db/queries/list-reels'
import { applyFeed, DEFAULT_FEED_STATE, type FeedState } from '@/lib/reels/filter'
import { toCardModel } from '@/lib/reels/view-model'
import { EmptyState } from './empty-state'
import { ReelsGrid } from './reels-grid'

type Props = {
  initialRows: ReelListRow[]
  /** Время сервера в миллисекундах — см. комментарий про гидрацию ниже. */
  serverNow: number
}

export function ReelsFeed({ initialRows, serverNow }: Props) {
  const [rows, setRows] = useState<ReelListRow[]>(initialRows)

  /**
   * «Сейчас» стартует со СЕРВЕРНОГО значения намеренно.
   *
   * Относительные даты зависят от текущего времени: сервер отрисует
   * «59 минут назад», а клиент при гидрации пересчитает и получит
   * «1 час назад» — React сообщит о расхождении разметки. Первый клиентский
   * рендер обязан повторить серверный, поэтому берём его время, а на своё
   * переключаемся уже после монтирования.
   */
  const [now, setNow] = useState(() => new Date(serverNow))

  useEffect(() => {
    // Ровно эта подмена и есть лекарство от хайдрейшн-мисматча: серверное
    // «сейчас» держится до монтирования, а не дольше. См. комментарий у
    // useState(now) выше.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNow(new Date())
    const timer = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(timer)
  }, [])

  const [feedState] = useState<FeedState>(DEFAULT_FEED_STATE)

  const cards = useMemo(
    () => applyFeed(rows, feedState, now).map((row) => toCardModel(row, now)),
    [rows, feedState, now],
  )

  // Управление, форма и мутации подключаются в задачах 8–10.
  const onSync = (id: string) => void id
  const onDelete = (id: string) => setRows((prev) => prev.filter((row) => row.id !== id))

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Лента</h1>

      {cards.length === 0 ? (
        <EmptyState />
      ) : (
        <ReelsGrid cards={cards} onSync={onSync} onDelete={onDelete} />
      )}
    </div>
  )
}
