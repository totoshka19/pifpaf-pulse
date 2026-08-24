import type { DetailRun } from '@/db/queries/reel-detail'
import { formatExactMsk, formatRelative } from '@/lib/format/date'

/**
 * Лог синхронизаций рилса: когда ходили за данными и чем это кончилось.
 *
 * Зачем он на экране. Обещание сервиса — «цифры обновляются сами». Лог это
 * обещание подтверждает: видно, что попытки были, сколько их и что пошло не
 * так, если пошло. Без него слово «обновляется» приходится принимать на веру.
 *
 * Про режим фикстур. `apify_run_id` с префиксом `mock:` означает, что прогон
 * шёл не в живой Apify, а по локальным фикстурам. Сам идентификатор наружу
 * не отдаём — блогеру он ничего не говорит. А вот пометку показываем: во
 * время демонстрации молчание о том, что данные ненастоящие, читалось бы
 * как попытка выдать одно за другое.
 */

const STATUS: Record<string, { label: string; className: string }> = {
  succeeded: { label: 'Успешно', className: 'text-[var(--up)]' },
  failed: { label: 'Ошибка', className: 'text-[var(--down)]' },
  running: { label: 'В процессе', className: 'text-[var(--muted)]' },
}

export function SyncLog({ runs, now }: { runs: DetailRun[]; now: number }) {
  if (runs.length === 0) {
    return (
      <p className="text-sm text-[var(--muted)]">
        Синхронизаций ещё не было — первая пойдёт сразу после добавления.
      </p>
    )
  }

  return (
    <ol className="flex flex-col gap-2">
      {runs.map((run) => {
        const status = STATUS[run.status] ?? STATUS.running
        // Сколько шёл прогон. null — прогон ещё не закончился.
        const seconds = run.finishedAt
          ? Math.round((run.finishedAt.getTime() - run.startedAt.getTime()) / 1000)
          : null

        return (
          <li
            key={run.startedAt.getTime()}
            className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-[var(--border)] pb-2 text-sm last:border-0"
          >
            <time
              dateTime={run.startedAt.toISOString()}
              title={formatExactMsk(run.startedAt)}
              className="text-[var(--muted)]"
            >
              {formatRelative(run.startedAt, new Date(now))}
            </time>

            <span className={status.className}>{status.label}</span>

            {seconds !== null && (
              <span className="text-xs text-[var(--muted)]">{seconds} с</span>
            )}

            {run.isMock && (
              <span
                className="rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-[11px] text-[var(--accent)]"
                title="Прогон шёл по локальным фикстурам, а не в живой Apify"
              >
                фикстуры
              </span>
            )}

            {run.error && <span className="w-full text-xs text-[var(--down)]">{run.error}</span>}
          </li>
        )
      })}
    </ol>
  )
}
