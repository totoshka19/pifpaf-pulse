import { eq } from 'drizzle-orm'
import { db, users } from '@/db'
import { fail, handleError, ok } from '@/lib/api/respond'
import { requireSession } from '@/lib/auth/require-session'
import { hashPassword, validatePassword, verifyPassword } from '@/lib/auth/password'

export const runtime = 'nodejs'

/**
 * Смена пароля.
 *
 * ТЕКУЩИЙ ПАРОЛЬ ПРОВЕРЯЕТСЯ ОБЯЗАТЕЛЬНО. Без этого забытая на чужом
 * устройстве вкладка превращается в захват аккаунта: достаточно открыть
 * настройки и задать новый пароль. Проверка текущего — единственное, что
 * стоит между угнанной сессией и потерей доступа.
 *
 * ЧЕГО МЫ НЕ МОЖЕМ. Сессия — подписанный JWT без серверного хранилища
 * (`src/lib/auth/session.ts`), отозвать выданные токены нечем. Смена пароля
 * НЕ выкидывает с других устройств: старый токен доживёт свои тридцать дней.
 * Это компромисс архитектуры, а не недосмотр, и поэтому в интерфейсе мы
 * не обещаем обратного. Записано в хвосты AGENTS.md.
 *
 * Правила пароля переиспользуются из `validatePassword`, а не пишутся заново:
 * тот уже знает и про минимальную длину, и про то, что bcrypt молча режет
 * вход на 72 байтах, а кириллица занимает по два.
 */
export async function POST(request: Request) {
  try {
    const session = await requireSession()
    const body = await request.json().catch(() => null)

    const currentPassword = typeof body?.currentPassword === 'string' ? body.currentPassword : ''
    const newPassword = typeof body?.newPassword === 'string' ? body.newPassword : ''

    if (!currentPassword) return fail('Введи текущий пароль', 400)

    const passwordError = validatePassword(newPassword)
    if (passwordError) return fail(passwordError, 400)

    const [user] = await db
      .select({ passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, session.userId))

    if (!user) return fail('Кабинет не найден — войди заново', 404)

    if (!(await verifyPassword(currentPassword, user.passwordHash))) {
      // Ровно столько, сколько нужно владельцу, чтобы понять, что набрал не то.
      // Разъяснять правила несуществующему злоумышленнику незачем.
      return fail('Текущий пароль не подошёл', 400)
    }

    // Проверяем ПОСЛЕ текущего пароля: иначе подбором «нового» пароля можно
    // было бы угадать существующий, не зная его.
    if (await verifyPassword(newPassword, user.passwordHash)) {
      return fail('Новый пароль совпадает с текущим', 400)
    }

    await db
      .update(users)
      .set({ passwordHash: await hashPassword(newPassword) })
      .where(eq(users.id, session.userId))

    return ok({ ok: true })
  } catch (error) {
    return handleError(error)
  }
}
