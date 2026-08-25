import { fail, handleError, ok } from '@/lib/api/respond'
import { runCronTick } from '@/lib/sync/run-cron'

export const runtime = 'nodejs'

/**
 * Точка входа фоновой синхронизации.
 *
 * Тонкий слой: разобрать секрет, позвать тик, вернуть отчёт. Вся логика —
 * в `src/lib/sync/run-cron.ts`, потому что её надо тестировать напрямую,
 * без поднятия HTTP.
 *
 * Секрет читается из ЗАГОЛОВКА, а не из query-параметра: строка запроса
 * оседает в логах прокси, браузера и самого планировщика, а заголовок — нет.
 *
 * Маршрут лежит под `/api/`, то есть вне матчера `proxy.ts` (`/app/:path*`),
 * поэтому сессия здесь не проверяется и редиректа на `/login` не будет.
 */
export async function POST(request: Request) {
  try {
    const secret = process.env.CRON_SECRET

    // Пустой секрет в окружении — это не «пускать всех», а поломка настройки.
    if (!secret) return fail('Синхронизация не настроена', 503)

    const header = request.headers.get('authorization') ?? ''
    if (header !== `Bearer ${secret}`) return fail('Нужен ключ', 401)

    const startedAt = Date.now()
    const report = await runCronTick()
    const ms = Date.now() - startedAt

    // Время тика в ответе — не украшение: у функции Netlify десять секунд,
    // и единственный способ заметить приближение к потолку — смотреть на
    // это число в логах планировщика.
    console.log('[cron]', JSON.stringify({ ...report, ms }))

    return ok({ ...report, ms })
  } catch (error) {
    return handleError(error)
  }
}
