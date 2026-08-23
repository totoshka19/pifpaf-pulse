import { NextResponse, type NextRequest } from 'next/server'
import { SESSION_COOKIE } from '@/lib/auth/cookie'
import { verifySession } from '@/lib/auth/session'

/**
 * Защита личного кабинета.
 *
 * В Next.js 16 файл называется `proxy.ts`, а не `middleware.ts`, и экспортирует
 * функцию `proxy`. Исполняется в Node.js-рантайме по умолчанию; опция `runtime`
 * здесь недоступна и бросает ошибку при попытке её задать.
 *
 * Проверяется только подпись токена — ни базы, ни bcrypt тут нет. Документация
 * просит держать proxy автономным: он может выполняться вне основного рантайма
 * приложения, в том числе на CDN.
 */
export async function proxy(request: NextRequest) {
  const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value)
  if (session) return NextResponse.next()

  const url = new URL('/login', request.url)
  // Куда вернуть после входа. Только путь, без хоста — иначе открытый редирект.
  url.searchParams.set('next', request.nextUrl.pathname)

  return NextResponse.redirect(url)
}

/**
 * Матчер обязателен. Без него proxy выполняется на КАЖДОМ запросе — включая
 * _next/static, оптимизацию картинок и файлы из public/. Редирект на /login
 * тогда убьёт загрузку собственных CSS и JS.
 */
export const config = {
  matcher: ['/app/:path*'],
}
