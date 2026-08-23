import type { NextResponse } from 'next/server'

export const SESSION_COOKIE = 'pp_session'

/** Совпадает с TTL токена в session.ts — иначе кука переживёт свой JWT. */
const MAX_AGE = 60 * 60 * 24 * 30

const BASE = {
  // httpOnly: JavaScript страницы не должен видеть токен — иначе любая XSS
  // превращается в угон сессии.
  httpOnly: true,
  // lax: куку не отправят при межсайтовых POST, но при обычном переходе
  // по ссылке отправят. Для входа этого достаточно, а CSRF отсекается.
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  path: '/',
} as const

export function setSessionCookie(response: NextResponse, token: string): NextResponse {
  response.cookies.set(SESSION_COOKIE, token, { ...BASE, maxAge: MAX_AGE })
  return response
}

export function clearSessionCookie(response: NextResponse): NextResponse {
  response.cookies.set(SESSION_COOKIE, '', { ...BASE, maxAge: 0 })
  return response
}
