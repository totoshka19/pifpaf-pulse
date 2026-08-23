import { describe, expect, it } from 'vitest'
import { hashPassword, MAX_PASSWORD_BYTES, validatePassword, verifyPassword } from './password'

describe('хеширование пароля', () => {
  it('хеш не совпадает с исходным паролем', async () => {
    const hash = await hashPassword('пароль123')
    expect(hash).not.toBe('пароль123')
    expect(hash.startsWith('$2')).toBe(true)
  })

  it('принимает верный пароль', async () => {
    const hash = await hashPassword('пароль123')
    expect(await verifyPassword('пароль123', hash)).toBe(true)
  })

  it('отвергает неверный пароль', async () => {
    const hash = await hashPassword('пароль123')
    expect(await verifyPassword('пароль124', hash)).toBe(false)
  })

  it('два хеша одного пароля различаются — соль работает', async () => {
    const [a, b] = await Promise.all([hashPassword('пароль123'), hashPassword('пароль123')])
    expect(a).not.toBe(b)
    expect(await verifyPassword('пароль123', a)).toBe(true)
    expect(await verifyPassword('пароль123', b)).toBe(true)
  })

  it('не падает на битом хеше, а возвращает false', async () => {
    expect(await verifyPassword('пароль123', 'не-хеш')).toBe(false)
    expect(await verifyPassword('пароль123', '')).toBe(false)
  })
})

describe('validatePassword — длина считается в БАЙТАХ', () => {
  it('пропускает нормальный пароль', () => {
    expect(validatePassword('пароль123')).toBeNull()
  })

  it('отвергает короткий', () => {
    expect(validatePassword('корот')).toMatch(/8/)
  })

  it('отвергает пустой', () => {
    expect(validatePassword('')).toBeTruthy()
  })

  it('латиница: граница ровно на 72 символах', () => {
    expect(validatePassword('a'.repeat(MAX_PASSWORD_BYTES))).toBeNull()
    expect(validatePassword('a'.repeat(MAX_PASSWORD_BYTES + 1))).toBeTruthy()
  })

  it('кириллица: граница наступает вдвое раньше, на 36 символах', () => {
    // 36 символов × 2 байта = 72 байта — ещё можно
    expect(validatePassword('я'.repeat(36))).toBeNull()
    // 37 символов = 74 байта — bcrypt отрезал бы хвост молча
    expect(validatePassword('я'.repeat(37))).toBeTruthy()
  })

  it('эмодзи считаются по своим байтам, а не по символам', () => {
    // 🔥 — 4 байта в UTF-8, 18 штук = 72 байта
    expect(validatePassword('🔥'.repeat(18))).toBeNull()
    expect(validatePassword('🔥'.repeat(19))).toBeTruthy()
  })
})
