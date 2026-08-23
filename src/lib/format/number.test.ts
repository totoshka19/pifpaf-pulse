import { describe, expect, it } from 'vitest'
import { formatCount, formatDelta, formatExact, NO_DATA } from './number'

/**
 * Разделитель разрядов — НЕРАЗРЫВНЫЙ пробел U+00A0, иначе «8 431» рвётся
 * переносом строки посреди числа.
 *
 * Пишем ИМЕННО escape-последовательностью, а не самим символом. Литеральный
 * U+00A0 в редакторе неотличим от обычного пробела: если и тест, и реализация
 * подхватят обычный, тест останется зелёным, а вёрстка сломается. С escape
 * такая подмена гарантированно красит тест.
 */
const NBSP = '\u00A0'
const MINUS = '\u2212'

describe('formatExact — полное число для тултипа', () => {
  it('разбивает на разряды неразрывным пробелом', () => {
    expect(formatExact(1_245_903)).toBe(`1${NBSP}245${NBSP}903`)
    expect(formatExact(8431)).toBe(`8${NBSP}431`)
  })

  it('числа до тысячи не трогает', () => {
    expect(formatExact(431)).toBe('431')
    expect(formatExact(0)).toBe('0')
  })

  it('нет данных — прочерк', () => {
    expect(formatExact(null)).toBe(NO_DATA)
  })
})

describe('formatCount — компактный вид', () => {
  it('до десяти тысяч показывает каждую цифру', () => {
    // Блогеру с 8 431 просмотром важна точность; «8,4 тыс.» её съедает.
    expect(formatCount(8431)).toBe(`8${NBSP}431`)
    expect(formatCount(9999)).toBe(`9${NBSP}999`)
  })

  it('тысячи от десяти и выше', () => {
    expect(formatCount(10_000)).toBe(`10${NBSP}тыс.`)
    expect(formatCount(12_345)).toBe(`12,3${NBSP}тыс.`)
    expect(formatCount(245_000)).toBe(`245${NBSP}тыс.`)
  })

  it('миллионы с одним знаком после запятой', () => {
    expect(formatCount(1_200_000)).toBe(`1,2${NBSP}млн`)
    // 14 123 499 — настоящее значение из fixtures/apify, PLAN.md §6.
    expect(formatCount(14_123_499)).toBe(`14,1${NBSP}млн`)
  })

  it('999 999 округляется в миллион, а не в «1000 тыс.»', () => {
    expect(formatCount(999_999)).toBe(`1${NBSP}млн`)
  })

  it('ноль — это ноль, а не «нет данных»', () => {
    // Прямое требование PLAN.md §12: путать 0 и null нельзя.
    expect(formatCount(0)).toBe('0')
    expect(formatCount(null)).toBe(NO_DATA)
  })

  it('дробное и бесконечность не ломают вывод', () => {
    expect(formatCount(1234.7)).toBe(`1${NBSP}234`)
    expect(formatCount(Number.POSITIVE_INFINITY)).toBe(NO_DATA)
    expect(formatCount(Number.NaN)).toBe(NO_DATA)
  })
})

describe('formatDelta — прирост со знаком', () => {
  it('рост показывает с плюсом', () => {
    expect(formatDelta(12_000)).toBe(`+12${NBSP}тыс.`)
    expect(formatDelta(340)).toBe('+340')
  })

  it('падение — типографским минусом, а не дефисом', () => {
    expect(formatDelta(-340)).toBe(`${MINUS}340`)
  })

  it('ноль остаётся нулём, решение о бейдже принимает не форматтер', () => {
    expect(formatDelta(0)).toBe('0')
  })

  it('нет данных — прочерк', () => {
    expect(formatDelta(null)).toBe(NO_DATA)
  })
})
