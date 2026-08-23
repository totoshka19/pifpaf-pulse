import { afterEach, describe, expect, it } from 'vitest'
import { currentPeriod, monthlyCap } from './budget'

afterEach(() => {
  delete process.env.APIFY_MONTHLY_CAP
})

describe('currentPeriod — ключ считается по московскому времени', () => {
  it('форматирует как YYYY-MM', () => {
    expect(currentPeriod(new Date('2026-08-23T12:00:00Z'))).toBe('2026-08')
  })

  it('однозначные месяцы дополняет нулём', () => {
    expect(currentPeriod(new Date('2026-01-05T12:00:00Z'))).toBe('2026-01')
  })

  it('учитывает сдвиг MSK на границе месяца', () => {
    // 31 августа 23:00 UTC = 1 сентября 02:00 в Москве → период уже сентябрьский.
    expect(currentPeriod(new Date('2026-08-31T23:00:00Z'))).toBe('2026-09')
  })

  it('учитывает сдвиг MSK на границе года', () => {
    expect(currentPeriod(new Date('2026-12-31T22:00:00Z'))).toBe('2027-01')
  })

  it('до сдвига остаётся в прежнем месяце', () => {
    // 31 августа 20:00 UTC = 23:00 МСК — ещё август.
    expect(currentPeriod(new Date('2026-08-31T20:00:00Z'))).toBe('2026-08')
  })

  it('формат всегда семь символов', () => {
    for (const iso of ['2026-01-01T00:00:00Z', '2026-09-30T12:00:00Z', '2030-11-11T11:11:11Z']) {
      expect(currentPeriod(new Date(iso))).toMatch(/^\d{4}-(0[1-9]|1[0-2])$/)
    }
  })
})

describe('monthlyCap', () => {
  it('читает APIFY_MONTHLY_CAP', () => {
    process.env.APIFY_MONTHLY_CAP = '900'
    expect(monthlyCap()).toBe(900)
  })

  it('без переменной берёт консервативное значение', () => {
    expect(monthlyCap()).toBe(1500)
  })

  it('мусор в переменной не превращает лимит в NaN', () => {
    process.env.APIFY_MONTHLY_CAP = 'много'
    expect(monthlyCap()).toBe(1500)
  })

  it('ноль и отрицательное игнорирует — иначе синк встал бы намертво', () => {
    process.env.APIFY_MONTHLY_CAP = '0'
    expect(monthlyCap()).toBe(1500)

    process.env.APIFY_MONTHLY_CAP = '-5'
    expect(monthlyCap()).toBe(1500)
  })

  it('лимит держится ниже реального потолка free tier', () => {
    // $5/мес ÷ $2.70 за 1000 результатов ≈ 1850. Буфер обязателен: часть
    // результатов уходит на повторы после ошибок актора.
    expect(monthlyCap()).toBeLessThan(1850)
  })
})
