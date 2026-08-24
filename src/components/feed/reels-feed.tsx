'use client'

import { useEffect, useMemo, useState } from 'react'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { ToastStack, useToasts } from '@/components/ui/toast'
import type { ReelListRow } from '@/db/queries/list-reels'
import { applyFeed, DEFAULT_FEED_STATE, type FeedState } from '@/lib/reels/filter'
import { reviveRow } from '@/lib/reels/parse'
import { nextPollDelay, shouldKeepPolling } from '@/lib/reels/poll'
import { toCardModel } from '@/lib/reels/view-model'
import { AddReelForm } from './add-reel-form'
import { EmptyState } from './empty-state'
import { FeedControls } from './feed-controls'
import { ReelsGrid } from './reels-grid'
import { ReelsTable } from './reels-table'

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

  const [feedState, setFeedState] = useState<FeedState>(DEFAULT_FEED_STATE)
  const [highlighted, setHighlighted] = useState<string | null>(null)

  const visible = useMemo(() => applyFeed(rows, feedState, now), [rows, feedState, now])
  const cards = useMemo(() => visible.map((row) => toCardModel(row, now)), [visible, now])

  const pendingIds = useMemo(
    () => rows.filter((row) => row.syncStatus === 'pending').map((row) => row.id),
    [rows],
  )

  /**
   * Опрос карточек в статусе pending.
   *
   * Ключ эффекта — строка из идентификаторов, а не сам массив: новый массив
   * с тем же содержимым перезапускал бы опрос с нулевой попытки на каждой
   * перерисовке, и лестница задержек никогда бы не поднялась.
   */
  const pendingKey = pendingIds.join(',')

  useEffect(() => {
    if (pendingIds.length === 0) return

    let attempt = 0
    let stopped = false
    let timer: ReturnType<typeof setTimeout>

    async function tick() {
      // Вкладка в фоне — не опрашиваем: забытая на ночь страница иначе
      // потратит тысячи вызовов функции Netlify впустую.
      if (document.hidden) {
        timer = setTimeout(tick, nextPollDelay(attempt))
        return
      }

      const results = await Promise.all(
        pendingIds.map(async (id) => {
          try {
            const response = await fetch(`/api/reels/${id}`)
            if (!response.ok) return null
            const data = await response.json()
            return data?.reel ?? null
          } catch {
            return null
          }
        }),
      )

      if (stopped) return

      // Хотя бы один рилс вышел из pending — перечитываем ленту целиком.
      // Сливать ответ карточки в строку ленты вручную не нужно: у карточки
      // нет ни последнего снапшота, ни growth7d, и половина полей разъедется.
      // После refresh список pending изменится, и эффект перезапустится сам
      // с новой лестницей задержек.
      if (results.some((reel) => reel && reel.syncStatus !== 'pending')) {
        // refresh объявлена ниже как function-декларация: она поднимается
        // (hoisting) и к моменту вызова уже существует.
        await refresh()
        return
      }

      attempt += 1

      if (shouldKeepPolling(attempt, pendingIds.length)) {
        timer = setTimeout(tick, nextPollDelay(attempt))
      }
    }

    timer = setTimeout(tick, nextPollDelay(0))

    return () => {
      stopped = true
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingKey])

  /** Полное обновление ленты одним запросом — после любой мутации. */
  async function refresh() {
    try {
      const response = await fetch('/api/reels')
      if (!response.ok) return
      const data = await response.json()
      setRows((data.reels as unknown[]).map(reviveRow))
    } catch {
      // Сеть моргнула — оставляем то, что уже показано. Список обновится
      // при следующей мутации или перезагрузке.
    }
  }

  const { toasts, push } = useToasts()
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)

  async function onSync(id: string) {
    // Оптимистично переводим карточку в «обновляем»: цифры на экране остаются,
    // потому что метрики живут в снапшотах, а не в строке рилса.
    setRows((prev) =>
      prev.map((row) => (row.id === id ? { ...row, syncStatus: 'pending' } : row)),
    )

    try {
      const response = await fetch(`/api/reels/${id}/sync`, { method: 'POST' })

      if (!response.ok) {
        const data = await response.json().catch(() => null)
        push(data?.error ?? 'Не получилось обновить рилс', 'error')
        await refresh()
        return
      }

      push('Обновляем — цифры подтянутся через пару секунд')
    } catch {
      push('Не получилось связаться с сервером. Проверь интернет', 'error')
      await refresh()
    }
  }

  async function confirmDelete() {
    const id = pendingDelete
    if (!id) return

    setPendingDelete(null)

    // Оптимистичное удаление: карточка исчезает сразу.
    const snapshot = rows
    setRows((prev) => prev.filter((row) => row.id !== id))

    try {
      const response = await fetch(`/api/reels/${id}`, { method: 'DELETE' })
      if (!response.ok) throw new Error()

      push('Рилс удалён')
    } catch {
      // Не получилось — возвращаем список как было. Молча «потерять» рилс
      // и оставить его в базе хуже, чем показать ошибку.
      setRows(snapshot)
      push('Не получилось удалить рилс. Он остался на месте', 'error')
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Лента</h1>

      <AddReelForm
        onAdded={(row) => {
          setRows((prev) => [row, ...prev])
          push('Добавили! Забираем данные из Instagram')
        }}
        onDuplicate={(id) => {
          push('Этот рилс уже добавлен')
          setHighlighted(id)
          document.getElementById(`reel-${id}`)?.scrollIntoView({
            behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
              ? 'auto'
              : 'smooth',
            block: 'center',
          })
          setTimeout(() => setHighlighted(null), 2500)
        }}
        onError={(message) => push(message, 'error')}
      />

      <FeedControls
        state={feedState}
        onChange={setFeedState}
        total={rows.length}
        shown={visible.length}
      />

      {cards.length === 0 ? (
        <EmptyState />
      ) : feedState.view === 'table' ? (
        <ReelsTable
          cards={cards}
          sort={feedState.sort}
          onSort={(sort) => setFeedState((prev) => ({ ...prev, sort }))}
          onSync={onSync}
          onDelete={setPendingDelete}
          highlighted={highlighted}
        />
      ) : (
        <ReelsGrid
          cards={cards}
          onSync={onSync}
          onDelete={setPendingDelete}
          highlighted={highlighted}
        />
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Удалить рилс?"
        text="Пропадут и метрики, и вся история просмотров по нему. Отменить не получится."
        confirmLabel="Удалить"
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />

      <ToastStack toasts={toasts} />
    </div>
  )
}
