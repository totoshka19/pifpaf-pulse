import { jwtVerify, SignJWT } from 'jose'

/**
 * Сессия в JWT, лежащем в httpOnly cookie.
 *
 * Здесь НЕ ДОЛЖНО быть импортов из `node:` — этот модуль вызывается и из
 * `src/proxy.ts`, и из route handlers. Формально Next 16 исполняет proxy в
 * Node-рантайме и позволил бы что угодно, но зависимость от Node API молча
 * убьёт запасной деплой на Cloudflare Workers (см. PLAN.md §4 и §13).
 */

export type Role = 'blogger' | 'admin'
export type Session = { userId: string; role: Role }

const ALG = 'HS256'
const TTL = '30d'

/** Ленивое чтение: переменные окружения доступны только в рантайме. */
function secret(): Uint8Array {
  const value = process.env.JWT_SECRET
  if (!value) throw new Error('JWT_SECRET не задан')
  return new TextEncoder().encode(value)
}

export async function signSession(session: Session): Promise<string> {
  return new SignJWT({ role: session.role })
    .setProtectedHeader({ alg: ALG })
    .setSubject(session.userId)
    .setIssuedAt()
    .setExpirationTime(TTL)
    .sign(secret())
}

export async function verifySession(
  token: string | undefined | null,
): Promise<Session | null> {
  if (!token) return null

  try {
    // algorithms задан явно как страховка, а не как единственная защита:
    // jose и сам отвергает {"alg":"none"}, потому что выводит допустимый
    // набор из типа ключа (симметричный → только HS*). Проверено снятием
    // этой опции — тест на alg:none остаётся зелёным. Список оставлен,
    // чтобы граница была явной при замене библиотеки.
    const { payload } = await jwtVerify(token, secret(), { algorithms: [ALG] })

    if (!payload.sub) return null

    // Роль приходит из токена, то есть снаружи. Белый список, а не доверие:
    // всё, что не ровно 'admin', становится 'blogger'.
    const role: Role = payload.role === 'admin' ? 'admin' : 'blogger'

    return { userId: payload.sub, role }
  } catch {
    // Просроченный, подделанный, чужим ключом подписанный, битый — всё это
    // снаружи выглядит одинаково: сессии нет.
    return null
  }
}
