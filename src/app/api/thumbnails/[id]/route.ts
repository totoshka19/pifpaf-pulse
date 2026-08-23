import { eq } from 'drizzle-orm'
import { db, reels } from '@/db'
import { readThumbnail } from '@/db/queries/thumbnails'
import { handleError } from '@/lib/api/respond'
import { assertOwned } from '@/lib/auth/ownership'
import { requireSession } from '@/lib/auth/require-session'

export const runtime = 'nodejs'

/**
 * Отдача обложки со своего домена.
 *
 * Смысл всего среза: ссылки Instagram подписаны и живут ~4,5 суток. Если бы
 * карточка ссылалась на CDN напрямую, через пять дней у проверяющего была бы
 * сетка пустых квадратов вместо обложек — а обложка названа в ТЗ поимённо,
 * наравне с просмотрами и датой.
 */
export async function GET(
  _request: Request,
  { params }: RouteContext<'/api/thumbnails/[id]'>,
) {
  try {
    const session = await requireSession()
    const { id } = await params

    const [found] = await db
      .select({ id: reels.id, userId: reels.userId })
      .from(reels)
      .where(eq(reels.id, id))

    assertOwned(found, session)

    const thumbnail = await readThumbnail(id)

    if (!thumbnail) {
      // Обложки нет — это не ошибка: ссылка могла протухнуть до дозаливки.
      // Компонент <ReelCover> покажет плейсхолдер.
      return new Response(null, { status: 404 })
    }

    return new Response(new Uint8Array(thumbnail.data), {
      headers: {
        'content-type': thumbnail.mime,
        // Картинка привязана к id рилса и не меняется — можно кешировать вечно.
        // private, а не public: ответ зависит от сессии, и общий кеш (CDN,
        // корпоративный прокси) не должен отдать её другому пользователю.
        'cache-control': 'private, max-age=31536000, immutable',
      },
    })
  } catch (error) {
    return handleError(error)
  }
}
