import { eq } from 'drizzle-orm'
import { db, users } from '@/db'
import { fail, handleError, ok } from '@/lib/api/respond'
import { requireSession } from '@/lib/auth/require-session'
import { normalizeInstagramHandle, validateDisplayName } from '@/lib/profile/validate'

export const runtime = 'nodejs'

/**
 * Правка профиля: имя и инстаграм-хендл.
 *
 * PATCH, а не PUT: оба поля необязательные, и «пришло только имя» означает
 * «поменяй только имя», а не «затри хендл пустым».
 *
 * Идентификатор пользователя берётся ТОЛЬКО из сессии. Приняв его из тела,
 * получили бы правку чужого профиля по номеру — ровно та дыра, от которой
 * `assertOwned` защищает рилсы.
 */
export async function PATCH(request: Request) {
  try {
    const session = await requireSession()
    const body = await request.json().catch(() => null)

    const patch: { displayName?: string; instagramHandle?: string | null } = {}

    if (typeof body?.displayName === 'string') {
      const error = validateDisplayName(body.displayName)
      if (error) return fail(error, 400)

      patch.displayName = body.displayName.trim()
    }

    if (typeof body?.instagramHandle === 'string') {
      const result = normalizeInstagramHandle(body.instagramHandle)
      if (!result.ok) return fail(result.reason, 400)

      // null — валидное значение: блогер стёр поле, хендла больше нет.
      patch.instagramHandle = result.handle
    }

    if (Object.keys(patch).length === 0) {
      return fail('Нечего сохранять — поля пустые', 400)
    }

    const [updated] = await db
      .update(users)
      .set(patch)
      .where(eq(users.id, session.userId))
      .returning({
        displayName: users.displayName,
        instagramHandle: users.instagramHandle,
      })

    // Пользователя удалили между проверкой сессии и записью. Токен подписан
    // на 30 дней и переживает своего владельца — см. session-user.ts.
    if (!updated) return fail('Кабинет не найден — войди заново', 404)

    // Возвращаем НОВЫЕ значения: форма не должна гадать, что получилось
    // из «@PifPafAI» после нормализации.
    return ok(updated)
  } catch (error) {
    return handleError(error)
  }
}
