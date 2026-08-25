import { eq } from 'drizzle-orm'
import { db, users } from '@/db'
import { setSessionCookie } from '@/lib/auth/cookie'
import { fail, handleError, ok } from '@/lib/api/respond'
import { signSession } from '@/lib/auth/session'

export const runtime = 'nodejs'

/**
 * Вход в демонстрационный кабинет одной кнопкой.
 *
 * Зачем. Сервис показывают ссылкой, и первый экран у проверяющего — пустой
 * кабинет: регистрация ради того, чтобы посмотреть, это лишний барьер, а
 * добавленный вручную рилс не даст ни истории роста, ни дашборда.
 *
 * ПАРОЛЬ ЗДЕСЬ НЕ УЧАСТВУЕТ ВООБЩЕ. Маршрут берёт почту демо-кабинета из
 * окружения и сразу подписывает сессию. Это и есть главная защита: почта
 * приходит ТОЛЬКО из `DEMO_EMAIL` и никогда из запроса, значит уговорить
 * маршрут впустить под чужой учёткой нечем — подставлять некуда. Пароль
 * (`DEMO_PASSWORD` в README) нужен лишь человеку, который захочет войти
 * через обычную форму.
 *
 * Без `DEMO_EMAIL` маршрут отвечает 404, как будто его нет. Это не
 * педантизм: на чужой копии проекта, где демо-кабинет не заведён, включённая
 * кнопка «войти как демо» была бы дырой, а не удобством.
 *
 * Про расход Apify. Демо-кабинет открыт всем, кто нажмёт кнопку, и рилсы в
 * нём можно добавлять — то есть тратить кредиты. Держат три уже готовых
 * предохранителя: часовой троттлинг на паре `(user_id, shortcode)`, пять
 * обновлений в минуту на пользователя и месячный `tryReserve`. Отдельной
 * защиты демо-кабинету не делаем: он и так под теми же лимитами, что все.
 */
export async function POST() {
  try {
    const email = process.env.DEMO_EMAIL?.trim().toLowerCase()

    if (!email) return fail('Не найдено', 404)

    const [user] = await db
      .select({ id: users.id, role: users.role, displayName: users.displayName })
      .from(users)
      .where(eq(users.email, email))

    if (!user) {
      // Переменная задана, а кабинета нет — это поломка настройки, и она
      // обязана оставить след: снаружи 404 неотличима от «демо выключено»,
      // и без записи в логе искать причину пришлось бы вслепую.
      console.error('[demo] DEMO_EMAIL задан, но такого кабинета нет:', email)
      return fail('Не найдено', 404)
    }

    const token = await signSession({ userId: user.id, role: user.role })

    return setSessionCookie(ok({ displayName: user.displayName }), token)
  } catch (error) {
    return handleError(error)
  }
}
