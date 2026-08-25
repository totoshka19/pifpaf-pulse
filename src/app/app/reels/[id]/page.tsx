import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ReelCover } from '@/components/reel-cover'
import { SyncButton } from '@/components/reels/sync-button'
import { SyncLog } from '@/components/reels/sync-log'
import { ChartFrame } from '@/components/stats/chart-frame'
import { ChartTable } from '@/components/stats/chart-table'
import { LazyGrowthChart } from '@/components/stats/lazy-charts'
import { reelDetail } from '@/db/queries/reel-detail'
import { requireSession } from '@/lib/auth/require-session'
import { formatExactMsk, formatRelative } from '@/lib/format/date'
import { formatCount, formatExact, NO_DATA } from '@/lib/format/number'
import { toGrowthSeries } from '@/lib/stats/chart-data'

/**
 * Заголовок вкладки — по подписи рилса.
 *
 * Здесь НЕ зовём `notFound()`: метаданные считаются параллельно со страницей,
 * и решение о 404 должно приниматься в одном месте — в самой странице.
 * Чужой рилс тут просто даёт нейтральный заголовок, ничего не выдавая.
 */
export async function generateMetadata({ params }: PageProps<'/app/reels/[id]'>) {
  const session = await requireSession()
  const { id } = await params
  const detail = await reelDetail(session.userId, id)

  if (!detail) return { title: 'Рилс не найден' }

  const caption = detail.reel.caption?.trim()

  return {
    title: caption ? `${caption.slice(0, 50)}${caption.length > 50 ? '…' : ''}` : 'Рилс',
  }
}

/**
 * Экран одного рилса.
 *
 * Ради графика роста этот экран и существует. Он единственное место, где
 * видно, что сервис ходит за данными ПОВТОРНО: не один слепок, а цепочка
 * замеров. Всё обещание «цифры обновляются сами» держится на нём и на логе
 * синхронизаций под ним.
 *
 * `reelDetail` отдаёт `null` и для чужого рилса, и для несуществующего —
 * снаружи они обязаны быть неотличимы. `notFound()` даёт 404, не 403.
 */
export default async function ReelPage({ params }: PageProps<'/app/reels/[id]'>) {
  const session = await requireSession()
  const { id } = await params

  const detail = await reelDetail(session.userId, id)
  if (!detail) notFound()

  const { reel, snapshots, runs } = detail
  const latest = snapshots.at(-1)
  const points = toGrowthSeries(snapshots)

  // Серверный компонент вызывается один раз за запрос и не мемоизируется
  // React Compiler — тот же приём против расхождения разметки, что в ленте.
  // eslint-disable-next-line react-hooks/purity
  const serverNow = Date.now()

  const er =
    latest?.views && latest.likes !== null && latest.comments !== null
      ? `${(Math.round(((latest.likes + latest.comments) / latest.views) * 1000) / 10)
          .toString()
          .replace('.', ',')} %`
      : NO_DATA

  const metrics = [
    { label: 'Просмотры', value: formatCount(latest?.views ?? null), title: formatExact(latest?.views ?? null) },
    { label: 'Лайки', value: formatCount(latest?.likes ?? null), title: formatExact(latest?.likes ?? null) },
    { label: 'Комментарии', value: formatCount(latest?.comments ?? null), title: formatExact(latest?.comments ?? null) },
    { label: 'Вовлечённость', value: er, title: undefined },
  ]

  return (
    <div className="flex flex-col gap-6">
      <Link href="/app/reels" className="text-sm text-[var(--muted)] hover:text-[var(--ink)]">
        ← К ленте
      </Link>

      <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
        <div className="w-40 shrink-0 self-center sm:self-start">
          <ReelCover
            reelId={reel.id}
            author={reel.ownerUsername ? `@${reel.ownerUsername}` : null}
            caption={reel.caption}
            version={reel.lastSyncedAt ? reel.lastSyncedAt.getTime() : null}
            priority
          />
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex flex-col gap-1">
            {/* Подпись обрезаем CSS'ом, а не в JS: полный текст остаётся
                в разметке для поиска по странице и уезжает в title.
                Без обрезки хвост хештегов занимает на телефоне весь экран,
                и метрики уходят под сгиб. */}
            <h1
              className="line-clamp-3 text-xl font-semibold leading-snug"
              title={reel.caption?.trim() || undefined}
            >
              {reel.caption?.trim() || 'Без подписи'}
            </h1>
            <p className="text-sm text-[var(--muted)]">
              {reel.ownerUsername && <span>@{reel.ownerUsername} · </span>}
              <span title={formatExactMsk(reel.postedAt)}>
                {reel.postedAt ? `опубликован ${formatRelative(reel.postedAt, new Date(serverNow))}` : 'дата публикации неизвестна'}
              </span>
            </p>
          </div>

          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {metrics.map((metric) => (
              <div key={metric.label} className="flex flex-col gap-0.5">
                <dt className="text-xs text-[var(--muted)]">{metric.label}</dt>
                <dd className="text-lg font-semibold tabular-nums" title={metric.title}>
                  {metric.value}
                </dd>
              </div>
            ))}
          </dl>

          {reel.syncError && <p className="text-sm text-[var(--down)]">{reel.syncError}</p>}

          <div className="flex flex-wrap items-center gap-3">
            <SyncButton reelId={reel.id} disabled={reel.syncStatus === 'pending'} />

            {/* Ссылка в Instagram СОХРАНЕНА: до этого среза клик по карточке
                вёл именно туда, и молча подменить одно другим значило бы
                отобрать привычное действие. */}
            <a
              href={reel.url}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm hover:bg-[var(--accent-soft)]"
            >
              Открыть в Instagram
            </a>

            {reel.lastSyncedAt && (
              <span
                className="text-xs text-[var(--muted)]"
                title={formatExactMsk(reel.lastSyncedAt)}
              >
                обновлено {formatRelative(reel.lastSyncedAt, new Date(serverNow))}
              </span>
            )}
          </div>
        </div>
      </div>

      <ChartFrame
        title="Как набирались просмотры"
        hint={`замеров: ${points.length}`}
        empty={points.length === 0}
        emptyText="Замеров пока нет. Первый пойдёт сразу после добавления рилса."
      >
        {points.length === 1 ? (
          // Одна точка — не график. Рисовать по ней линию значит выдумывать
          // динамику, которой ещё не существует.
          <p className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface-2)] px-4 py-8 text-center text-sm text-[var(--muted)]">
            Данных пока мало: первый замер сделан{' '}
            {formatExactMsk(snapshots[0].capturedAt)}. Следующий — по расписанию,
            график появится после него.
          </p>
        ) : (
          <>
            <LazyGrowthChart points={points} />
            <ChartTable
              points={points}
              caption="Замеры просмотров по времени"
              valueLabel="Просмотров"
              labelHeader="Замер"
            />
          </>
        )}
      </ChartFrame>

      <section className="flex flex-col gap-3 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--shadow)] sm:p-6">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-base font-semibold">Синхронизации</h2>
          <p className="text-xs text-[var(--muted)]">когда сервис ходил за свежими цифрами</p>
        </div>

        <SyncLog runs={runs} now={serverNow} />
      </section>
    </div>
  )
}
