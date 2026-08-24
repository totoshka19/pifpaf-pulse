import { describe, expect, it } from 'vitest'
import { checkUserRate, USER_SYNC_LIMIT } from './rate-limit'

const NOW = new Date('2026-08-24T12:00:00Z')

describe('checkUserRate', () => {
  it('пропускает, когда попыток меньше лимита', () => {
    expect(checkUserRate(0, NOW)).toEqual({ allowed: true })
    expect(checkUserRate(USER_SYNC_LIMIT - 1, NOW)).toEqual({ allowed: true })
  })

  it('отказывает ровно на лимите', () => {
    // Пятая попытка уже записана — шестая не пройдёт.
    expect(checkUserRate(USER_SYNC_LIMIT, NOW).allowed).toBe(false)
  })

  it('отказывает и выше лимита', () => {
    expect(checkUserRate(USER_SYNC_LIMIT + 10, NOW).allowed).toBe(false)
  })

  it('в отказе человеческий текст без кода ошибки', () => {
    const verdict = checkUserRate(USER_SYNC_LIMIT, NOW)

    expect(verdict.allowed).toBe(false)
    if (verdict.allowed) return
    expect(verdict.message).toMatch(/[а-яё]/i)
    expect(verdict.message).not.toMatch(/\b\d{3}\b/)
  })

  it('отрицательное число не роняет и не блокирует', () => {
    // Счётчик из базы отрицательным быть не может, но падать на этом
    // сообщением про SQL — худший из возможных ответов.
    expect(checkUserRate(-1, NOW)).toEqual({ allowed: true })
  })
})
