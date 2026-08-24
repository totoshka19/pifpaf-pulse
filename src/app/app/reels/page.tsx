import type { Metadata } from 'next'
import { listReels } from '@/db/queries/list-reels'
import { requireSession } from '@/lib/auth/require-session'
import { ReelsFeed } from '@/components/feed/reels-feed'

export const metadata: Metadata = { title: 'Лента' }

/**
 * Данные берутся вызовом `listReels` НАПРЯМУЮ, без обращения к собственному
 * `GET /api/reels`: серверный компонент и так на сервере, и лишний HTTP-хоп
 * добавил бы к первой отрисовке круг по сети и вторую сериализацию.
 *
 * `serverNow` уезжает пропом намеренно — см. комментарий в `<ReelsFeed>`.
 */
export default async function ReelsPage() {
  const session = await requireSession()
  const rows = await listReels(session.userId)

  // Серверный компонент вызывается один раз за запрос и не мемоизируется React
  // Compiler. Date.now() здесь и есть лекарство от хайдрейшн-мисматча, а не его
  // причина: см. комментарий в <ReelsFeed>.
  // eslint-disable-next-line react-hooks/purity
  return <ReelsFeed initialRows={rows} serverNow={Date.now()} />
}
