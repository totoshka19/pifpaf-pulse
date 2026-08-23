import { describe, expect, it } from 'vitest'
import { plural } from './plural'

const REEL = ['рилс', 'рилса', 'рилсов'] as const

describe('plural — русское склонение по числу', () => {
  it('единственное число на 1', () => {
    expect(plural(1, REEL)).toBe('рилс')
    expect(plural(21, REEL)).toBe('рилс')
    expect(plural(101, REEL)).toBe('рилс')
  })

  it('двойственная форма на 2–4', () => {
    expect(plural(2, REEL)).toBe('рилса')
    expect(plural(3, REEL)).toBe('рилса')
    expect(plural(4, REEL)).toBe('рилса')
    expect(plural(22, REEL)).toBe('рилса')
  })

  it('множественное на 5–20 и на ноль', () => {
    expect(plural(0, REEL)).toBe('рилсов')
    expect(plural(5, REEL)).toBe('рилсов')
    expect(plural(20, REEL)).toBe('рилсов')
  })

  it('подростковое исключение 11–14 сильнее последней цифры', () => {
    // Ловушка: 11 оканчивается на 1, но это «одиннадцать рилсов».
    expect(plural(11, REEL)).toBe('рилсов')
    expect(plural(12, REEL)).toBe('рилсов')
    expect(plural(14, REEL)).toBe('рилсов')
    expect(plural(111, REEL)).toBe('рилсов')
    expect(plural(112, REEL)).toBe('рилсов')
  })

  it('отрицательные и дробные приводятся к целому модулю', () => {
    expect(plural(-2, REEL)).toBe('рилса')
    expect(plural(1.9, REEL)).toBe('рилс')
  })
})
