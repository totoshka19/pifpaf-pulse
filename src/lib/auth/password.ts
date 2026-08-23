import bcrypt from 'bcryptjs'

/**
 * Хеширование паролей. Только для route handlers.
 *
 * В `src/proxy.ts` этот модуль не импортируется: там проверяется подпись
 * токена, а не пароль, и лишний вес в перехватчике оплачивается на каждом
 * запросе.
 */

const SALT_ROUNDS = 10

export const MIN_PASSWORD_LENGTH = 8

/**
 * bcrypt молча обрезает вход на 72 байтах — не бросает ошибку, а отбрасывает
 * хвост. Два разных пароля с одинаковыми первыми 72 байтами пройдут проверку
 * одним и тем же хешом.
 *
 * Считать надо именно БАЙТЫ: кириллица в UTF-8 занимает по два байта, то есть
 * лимит наступает уже на 36 символах — вполне достижимая длина для парольной
 * фразы. Поэтому проверяем явно, а не надеемся на библиотеку.
 */
export const MAX_PASSWORD_BYTES = 72

/** Возвращает текст ошибки для интерфейса или null, если пароль годится. */
export function validatePassword(plain: string): string | null {
  if (!plain) return 'Придумай пароль'

  if (plain.length < MIN_PASSWORD_LENGTH) {
    return `Пароль короче ${MIN_PASSWORD_LENGTH} символов`
  }

  if (Buffer.byteLength(plain, 'utf8') > MAX_PASSWORD_BYTES) {
    return 'Пароль слишком длинный — сократи его'
  }

  return null
}

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS)
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  // Битый или пустой хеш в базе не должен ронять вход — это просто «не сошлось».
  try {
    return await bcrypt.compare(plain, hash)
  } catch {
    return false
  }
}
